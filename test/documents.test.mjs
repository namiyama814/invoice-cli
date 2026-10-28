import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDocument, calculateDocument, exampleFor, documentTypes } from '../dist/documents.js';
import { createDocumentForm, documentEndpoint, generatePdf } from '../dist/site.js';
import { example } from '../dist/invoice.js';
const qualified = changes => parseDocument({ ...exampleFor('invoice2'), ...changes });
test('既存JSONとの互換性と各帳票のサンプル', () => {
  assert.equal(parseDocument(example).type, 'invoice');
  assert.equal(calculateDocument(parseDocument(example)).total, 110000);
  for (const type of documentTypes) {
    const doc = parseDocument(exampleFor(type));
    assert.equal(doc.type, type);
    assert.equal(calculateDocument(doc).total, 110000);
    assert.equal(documentEndpoint(doc), `https://codeforfun.jp/tools/${type}/${type === 'invoice2' ? 'invoice' : type}.php`);
  }
});
test('帳票別に未対応項目を拒否する', () => {
  for (const type of ['estimate', 'delivery', 'receipt']) {
    for (const changes of [{ stamp: 'stamp.png' }, { withholdingTax: 100 }, { bankDetails: '銀行' }, { dueDate: '2026-11-30' }, { taxRate: 8 }]) {
      assert.throws(() => parseDocument({ ...exampleFor(type), ...changes }));
    }
  }
  for (const type of [null, '', 'other', 1, {}, [], ['invoice']]) assert.throws(() => parseDocument({ ...example, type }));
  for (const type of ['estimate', 'delivery']) {
    assert.throws(() => parseDocument({ ...exampleFor(type), documentDate: '2026-02-29' }));
    assert.throws(() => parseDocument({ ...exampleFor(type), documentNumber: 123 }));
    assert.throws(() => parseDocument({ ...exampleFor(type), items: [{ name: '品', unitPrice: 1, quantity: 1, taxRate: 8 }] }));
  }
});
test('見積書・納品書のフィールドと税なし', () => {
  for (const type of ['estimate', 'delivery']) {
    const doc = parseDocument({ ...exampleFor(type), taxEnabled: false });
    const form = createDocumentForm(doc);
    assert.equal(form.get(`${type}_date`), '2026/10/28');
    assert.equal(form.get(`${type}_num`), type === 'estimate' ? 'EST-001' : 'DEL-001');
    assert.equal(form.get('tax_include'), '2');
    assert.equal(form.get('total'), '100,000 円');
    for (const absent of ['hidden_tax_include', 'bank_detail', 'stamp', 'invoice_num', 'format_tax_withholding']) assert.equal(form.has(absent), false);
  }
});
test('領収書の金額・内訳・縦横レイアウト', () => {
  for (const layout of ['portrait', 'landscape']) {
    const doc = parseDocument({ ...exampleFor('receipt'), layout });
    const form = createDocumentForm(doc);
    assert.equal(form.get('layout'), layout === 'portrait' ? '1' : '2');
    assert.equal(form.get('total'), '110,000');
    assert.equal(form.get('no_tax'), '100,000');
    assert.equal(form.get('tax'), '10%');
    assert.equal(form.get('receipt_date'), '2026/10/28');
    assert.equal(form.get('details'), '銀行振込');
    assert.equal(form.get('subject'), '開発費として');
    assert.equal(form.has('item_name[]'), false);
  }
  for (const changes of [{ total: undefined }, { total: -1 }, { total: null }, { total: 1.5 }, { netAmount: '1' }, { layout: 'square' }, { documentDate: '2026-02-29' }, { details: 1 }]) {
    assert.throws(() => parseDocument({ ...exampleFor('receipt'), ...changes }));
  }
  assert.equal(createDocumentForm(parseDocument({ type: 'receipt', to: '宛先', fromAddress: '送付者', total: 0 })).get('no_tax'), '');
});
test('インボイス版の税率別集計・対象外・軽減税率マーク', () => {
  const doc = qualified({ items: [
    { name: '標準', unitPrice: 19, quantity: 1 },
    { name: '標準2', unitPrice: 19, quantity: 1 },
    { name: '軽減', unitPrice: 19, quantity: 1, taxRate: 8 },
    { name: '軽減2', unitPrice: 19, quantity: 1, taxRate: 8 },
    { name: '対象外', unitPrice: 100, quantity: 1, taxRate: 'exempt' }
  ] });
  const sums = calculateDocument(doc);
  assert.deepEqual(sums, { amounts: [19, 19, 19, 19, 100], subtotal: 176, tax: 6, withholdingTax: 0, total: 182, sum10: 38, sum8: 38, tax10: 3, tax8: 3 });
  const form = createDocumentForm(doc, { data: Buffer.from([137,80,78,71]), type: 'image/png', name: 'stamp.png' });
  assert.deepEqual(form.getAll('item_name[]'), ['標準', '標準2', '軽減　※', '軽減2　※', '対象外']);
  for (const [key, expected] of Object.entries({ sum_10: '38 円', tax_10: '3 円', sum_8: '38 円', tax_8: '3 円', tax: '6 円', registration_number: 'T0000000000000', gensen: '-0 円' })) assert.equal(form.get(key), expected);
  assert.equal(form.get('stamp').name, 'stamp.png');
  // The site posts the rendered preview, not the editor's tax selectors.
  assert.equal(form.has('item_tax[]'), false);
  assert.equal(form.has('hidden_tax_include'), false);
});
test('インボイス版の源泉徴収は対象明細だけ、100万円の境界と切り捨て', () => {
  for (const [base, expected] of [[19, 1], [1000000, 102100], [1000001, 102100], [2000000, 306300]]) {
    const sums = calculateDocument(qualified({ items: [
      { name: '対象', unitPrice: base, quantity: 1, withholding: true },
      { name: '対象外', unitPrice: 10000, quantity: 1 }
    ] }));
    assert.equal(sums.withholdingTax, expected);
  }
  for (const changes of [{ registrationNumber: '' }, { registrationNumber: null }, { taxEnabled: true }, { withholdingTax: 0 },
    ...[{ taxRate: null }, { taxRate: 0 }, { withholding: 1 }, { unknown: true }].map(item => ({ items: [{ name: '品', unitPrice: 1, quantity: 1, ...item }] })),
    { items: [{ name: '品', unitPrice: Number.MAX_SAFE_INTEGER, quantity: 1 }] }
  ]) assert.throws(() => qualified(changes));
});
test('各帳票のHTTP送信先を選択する', async () => {
  const original = globalThis.fetch;
  try {
    for (const type of documentTypes) {
      const doc = parseDocument(exampleFor(type));
      let sent;
      globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response('%PDF-1.4\nmock'); };
      await generatePdf(doc);
      assert.equal(sent.url, documentEndpoint(doc));
      assert.equal(sent.init.method, 'POST');
      assert.equal(sent.init.body instanceof URLSearchParams, ['estimate', 'delivery', 'receipt'].includes(type));
    }
  } finally { globalThis.fetch = original; }
});
test('CLIで各帳票の初期化・検証・生成・標準入力', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'invoice-formats-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = resolve('dist/cli.js');
  const run = (args, input, preload = []) => spawnSync(process.execPath, [...preload, cli, ...args], { cwd: dir, input, encoding: 'utf8' });
  for (const type of documentTypes) {
    const init = run(['init', '--type', type]);
    assert.equal(init.status, 0, init.stderr);
    const json = await readFile(join(dir, `${type}.json`), 'utf8');
    assert.equal(parseDocument(JSON.parse(json)).type, type);
    const validation = run(['validate', `${type}.json`]);
    assert.equal(validation.status, 0, validation.stderr);
    assert.match(validation.stdout, /110,000 円/);
    const code = `globalThis.fetch = async (url) => { if(url !== ${JSON.stringify(documentEndpoint(parseDocument(JSON.parse(json))))}) throw Error('wrong endpoint'); return new Response('%PDF-1.4\\nmock'); };`;
    const generated = run(['generate', '-', '-o', `${type}.pdf`], json, ['--import', `data:text/javascript,${encodeURIComponent(code)}`]);
    assert.equal(generated.status, 0, generated.stderr);
  }
  assert.equal(run(['init', '--type', 'unknown']).status, 1);
  assert.equal(run(['validate', 'invoice.json', '--type', 'receipt']).status, 1);
});
