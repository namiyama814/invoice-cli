import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { parseInvoice, calculate, example } from '../dist/invoice.js';
import { loadStamp, saveAtomic } from '../dist/files.js';
import { createForm, generatePdf } from '../dist/site.js';
const valid = (changes = {}) => parseInvoice({ ...example, ...changes });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
async function temp(t) { const path = await mkdtemp(join(tmpdir(), 'invoice-test-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
test('税率・切り捨て・源泉徴収・既定値', () => {
  assert.equal(calculate(valid()).total, 110000);
  assert.equal(calculate(valid({ taxRate: 8 })).total, 108000);
  assert.equal(calculate(valid({ taxEnabled: false, withholdingTax: 5000 })).total, 95000);
  assert.equal(calculate(valid({ items: [{ name: '品', unitPrice: 19, quantity: 1 }], withholdingTax: 1 })).total, 19);
  assert.equal(calculate(valid({ withholdingTax: 120000 })).total, -10000);
  const minimal = parseInvoice({ to: '宛先', fromAddress: '送付者', items: [{ name: '品', unitPrice: 0, quantity: 1 }] });
  assert.equal(minimal.taxRate, 10); assert.equal(minimal.taxEnabled, true); assert.equal(minimal.withholdingTax, 0);
  assert.equal(calculate(valid({ items: [{ name: '品', unitPrice: 900719925474099, quantity: 1 }], taxRate: 10 })).tax, 90071992547409);
});
test('入力検証', () => {
  for (const changes of [
    { typo: true }, { to: '' }, { fromAddress: ' ' }, { items: [] }, { items: Array(11).fill(example.items[0]) },
    { items: [{ ...example.items[0], extra: 1 }] }, { items: [{ name: '', unitPrice: 1, quantity: 1 }] },
    ...[-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1].map(unitPrice => ({ items: [{ name: '品', unitPrice, quantity: 1 }] })),
    { items: [{ name: '品', unitPrice: 1, quantity: 0 }] },
    { items: [{ name: '品', unitPrice: Number.MAX_SAFE_INTEGER, quantity: 2 }] },
    { taxEnabled: 'true' }, { taxRate: 5 }, { withholdingTax: null }, { withholdingTax: -1 }, { stamp: '' },
    { invoiceDate: '2026-02-29' }, { dueDate: '2026/10/28' }, { invoiceDate: '' }, { invoiceDate: '0000-01-01' }
  ]) assert.throws(() => valid(changes), JSON.stringify(changes));
  assert.doesNotThrow(() => valid({ invoiceDate: '2024-02-29', items: Array(10).fill(example.items[0]) }));
});
test('印鑑の形式・容量・パス', async t => {
  const dir = await temp(t);
  await writeFile(join(dir, 'stamp.png'), png);
  assert.equal((await loadStamp('stamp.png', dir)).type, 'image/png');
  await writeFile(join(dir, 'stamp.jpeg'), Buffer.from([255,216,255,224]));
  assert.equal((await loadStamp('stamp.jpeg', dir)).type, 'image/jpeg');
  await writeFile(join(dir, 'bad.png'), 'not png');
  await writeFile(join(dir, 'large.png'), Buffer.alloc(1048577));
  for (const path of ['missing.png', 'bad.png', 'large.png', 'stamp.gif']) await assert.rejects(loadStamp(path, dir));
});
test('フォームのフィールドと明細配列', () => {
  const form = createForm(valid({ withholdingTax: 5000, items: [...example.items, { name: '追加', unitPrice: 10, quantity: 2 }] }));
  assert.equal(form.get('invoice_date'), '2026/10/28');
  assert.equal(form.get('hidden_gensen_include'), '1');
  assert.equal(form.get('format_tax_withholding'), '-5,000 円');
  assert.equal(form.get('total'), '105,022 円');
  assert.deepEqual(form.getAll('item_unit[]'), ['100,000', '10']);
  assert.deepEqual(form.getAll('item_price[]'), ['100,000', '20']);
  assert.equal(createForm(valid({ taxEnabled: false })).get('hidden_tax_include'), '2');
});
test('HTTP送信・PDF・HTML・HTTPエラー・タイムアウト', async t => {
  let mode = 'pdf'; let received;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = { body: Buffer.concat(chunks).toString(), headers: req.headers, method: req.method };
    if (mode === 'timeout') return;
    res.writeHead(mode === 'error' ? 500 : 200, { 'Content-Type': mode === 'pdf' ? 'application/pdf' : 'text/html' });
    res.end(mode === 'pdf' ? '%PDF-1.4\nmock' : '<html>error</html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const options = { url: `http://127.0.0.1:${server.address().port}` };
  const stamp = { data: png, name: 'stamp.png', type: 'image/png' };
  assert.equal((await generatePdf(valid(), stamp, options)).toString(), '%PDF-1.4\nmock');
  assert.equal(received.method, 'POST');
  assert.match(received.headers['content-type'], /multipart\/form-data; boundary=/);
  assert.match(received.body, /name="stamp"; filename="stamp.png"/);
  assert.match(received.body, /株式会社サンプル/);
  assert.match(received.body, /name="total"\r\n\r\n110,000 円/);
  mode = 'html'; await assert.rejects(generatePdf(valid(), undefined, options), /PDF以外/);
  mode = 'error'; await assert.rejects(generatePdf(valid(), undefined, options), /HTTP 500/);
  mode = 'timeout'; await assert.rejects(generatePdf(valid(), undefined, { ...options, timeoutMs: 20 }), /完了しません/);
});
test('原子的保存・上書き・一時ファイル削除', async t => {
  const dir = await temp(t); const path = join(dir, 'invoice.pdf');
  await saveAtomic(path, 'original', false);
  await assert.rejects(saveAtomic(path, 'new', false));
  assert.equal(await readFile(path, 'utf8'), 'original');
  await saveAtomic(path, 'new', true);
  assert.equal(await readFile(path, 'utf8'), 'new');
  await mkdir(join(dir, 'directory'));
  await assert.rejects(saveAtomic(join(dir, 'directory'), 'bad', true));
  assert.deepEqual((await readdir(dir)).sort(), ['directory', 'invoice.pdf']);
});
const cli = resolve('dist/cli.js');
function run(cwd, args, input) { return spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: 'utf8' }); }
test('CLIのファイル・標準入力・初期化・終了コード', async t => {
  const dir = await temp(t);
  assert.equal(run(dir, ['init']).status, 0);
  assert.equal(run(dir, ['init']).status, 1);
  assert.equal(run(dir, ['init', '--force']).status, 0);
  const validation = run(dir, ['validate', 'invoice.json']);
  assert.equal(validation.status, 0); assert.match(validation.stdout, /110,000 円/);
  assert.equal(run(dir, ['validate', '-'], JSON.stringify(example)).status, 0);
  assert.equal(run(dir, ['validate', '-'], '{bad').status, 1);
  assert.equal(run(dir, ['generate', 'invoice.json']).status, 1);
  assert.equal(run(dir, ['validate', 'missing.json']).status, 1);
  assert.equal(run(dir, ['--unknown']).status, 1);
  assert.match(run(dir, ['--help']).stdout, /使い方/);
  assert.equal(run(dir, ['--version']).stdout.trim(), '0.2.0');
  await writeFile(join(dir, 'exists.pdf'), 'original');
  assert.equal(run(dir, ['generate', 'invoice.json', '-o', 'exists.pdf']).status, 1);
  assert.equal(await readFile(join(dir, 'exists.pdf'), 'utf8'), 'original');
  await mkdir(join(dir, 'nested'));
  await writeFile(join(dir, 'nested', 'stamp.png'), png);
  await writeFile(join(dir, 'nested', 'input.json'), JSON.stringify({ ...example, stamp: 'stamp.png' }));
  assert.equal(run(dir, ['validate', 'nested/input.json']).status, 0);
  assert.equal(run(join(dir, 'nested'), ['validate', '-'], JSON.stringify({ ...example, stamp: 'stamp.png' })).status, 0);
});
test('CLI経由のPDF生成・標準入力・上書き・不正応答時の保持', async t => {
  const dir = await temp(t);
  await writeFile(join(dir, 'input.json'), JSON.stringify(example));
  const invoke = (args, input, body = '%PDF-1.4\ncli mock') => {
    const code = `globalThis.fetch = async () => new Response(${JSON.stringify(body)}, {headers:{'content-type':'application/pdf'}});`;
    return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(code)}`, cli, ...args], { cwd: dir, input, encoding: 'utf8' });
  };
  const generated = invoke(['generate', 'input.json', '-o', 'result.pdf']);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(await realpath(generated.stdout.trim()), await realpath(join(dir, 'result.pdf')));
  assert.equal(await readFile(join(dir, 'result.pdf'), 'utf8'), '%PDF-1.4\ncli mock');
  assert.equal(invoke(['generate', '-', '-o', 'stdin.pdf'], JSON.stringify(example)).status, 0);
  assert.equal(invoke(['generate', 'input.json', '-o', 'result.pdf', '--force'], undefined, '<html>failure</html>').status, 1);
  assert.equal(await readFile(join(dir, 'result.pdf'), 'utf8'), '%PDF-1.4\ncli mock');
  assert.equal(invoke(['generate', 'input.json', '-o', 'result.pdf', '--force'], undefined, '%PDF-1.4\nreplacement').status, 0);
  assert.equal(await readFile(join(dir, 'result.pdf'), 'utf8'), '%PDF-1.4\nreplacement');
  assert.equal((await readdir(dir)).some(name => name.startsWith('.invoice-cli-')), false);
});
