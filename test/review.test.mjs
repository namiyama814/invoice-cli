import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { documentTypes, exampleFor, parseDocument } from '../dist/documents.js';
import { createDocumentForm } from '../dist/site.js';

const literal = 'テスト <A> & B "確認" \'例\' &lt;原文&gt;';
const escaped = 'テスト &lt;A&gt; &amp; B &quot;確認&quot; &#39;例&#39; &amp;lt;原文&amp;gt;';
test('全帳票で入力文字列をHTMLとして解釈させない', () => {
  for (const type of documentTypes) {
    const data = structuredClone(exampleFor(type));
    Object.assign(data, { to: literal, toAddress: literal, fromAddress: literal, subject: literal });
    if (type !== 'receipt') { data.note = `${literal}\n2行目`; data.items[0].name = literal; }
    else Object.assign(data, { details: literal, taxDescription: literal });
    const form = createDocumentForm(parseDocument(data));
    for (const key of ['to', 'to_address', 'from_address', 'subject']) assert.equal(form.get(key), escaped, `${type}.${key}`);
    if (type !== 'receipt') {
      assert.equal(form.get('item_name[]'), escaped, type);
      assert.equal(form.get('note'), `${escaped}\n2行目`);
    } else {
      assert.equal(form.get('details'), escaped);
      assert.equal(form.get('tax'), escaped);
    }
  }
});
const cli = resolve('dist/cli.js');
function run(cwd, args, input) {
  // Any network request means the output preflight check failed.
  const code = `globalThis.fetch = async () => { console.error('UNEXPECTED_NETWORK'); return new Response('%PDF-1.4\\nmock'); };`;
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(code)}`, cli, ...args], { cwd, input, encoding: 'utf8', timeout: 5000 });
}
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'invoice-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('入力JSONと同じ保存先はforce指定でも通信前に拒否する', async t => {
  const dir = await temp(t);
  for (const type of documentTypes) {
    const filename = `${type}.json`;
    const json = JSON.stringify(exampleFor(type));
    await writeFile(join(dir, filename), json);
    const result = run(dir, ['generate', filename, '-o', filename, '--force']);
    assert.equal(result.status, 1, type);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK/);
    assert.equal(await readFile(join(dir, filename), 'utf8'), json);
  }
});
test('別表記・シンボリックリンク・ハードリンクでも入力を保護する', async t => {
  const dir = await temp(t);
  const json = JSON.stringify(exampleFor('invoice'));
  await writeFile(join(dir, 'input.json'), json);
  await link(join(dir, 'input.json'), join(dir, 'hardlink.json'));
  await symlink(join(dir, 'input.json'), join(dir, 'symlink.json'));
  for (const output of ['./input.json', 'hardlink.json', 'symlink.json']) {
    const result = run(dir, ['generate', 'input.json', '-o', output, '--force']);
    assert.equal(result.status, 1, output);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK/);
    assert.equal(await readFile(join(dir, output), 'utf8'), json);
  }
});
test('印鑑画像と同じ保存先も標準入力を含めて保護する', async t => {
  const dir = await temp(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(dir, 'stamp.png'), png);
  for (const type of ['invoice', 'invoice2']) {
    const json = JSON.stringify({ ...exampleFor(type), stamp: 'stamp.png' });
    const result = run(dir, ['generate', '-', '-o', 'stamp.png', '--force'], json);
    assert.equal(result.status, 1, type);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK/);
    assert.deepEqual(await readFile(join(dir, 'stamp.png')), png);
  }
});
test('保存先がディレクトリ・親が存在しない場合は通信前に失敗する', async t => {
  const dir = await temp(t);
  await mkdir(join(dir, 'directory'));
  await writeFile(join(dir, 'file'), 'not a directory');
  for (const path of ['directory', 'missing/output.pdf', 'file/output.pdf']) {
    const result = run(dir, ['generate', '-', '-o', path, '--force'], JSON.stringify(exampleFor('invoice')));
    assert.equal(result.status, 1, path);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK/);
  }
});
test('空文字のオプションでも不正なコマンドへの指定を拒否する', async t => {
  const dir = await temp(t);
  assert.equal(run(dir, ['init', '--output=']).status, 1);
  const result = run(dir, ['validate', '-', '--type='], JSON.stringify(exampleFor('invoice')));
  assert.equal(result.status, 1);
  assert.equal(run(dir, ['validate', '-', '--output='], JSON.stringify(exampleFor('invoice'))).status, 1);
});
