#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocument, calculateDocument, exampleFor, parseDocumentType } from './documents.js';
import { loadStamp, checkOutput, saveAtomic } from './files.js';
import { generatePdf } from './site.js';
const help = `invoice-cli — JSONから帳票PDFを作成

使い方:
  invoice-cli init [--type <種別>] [--force]
  invoice-cli validate <invoice.json|->
  invoice-cli generate <invoice.json|-> -o <invoice.pdf> [--force]

  -o, --output <パス>  PDFの保存先
  --type <種別>       initの帳票種別（既定: invoice）
                      invoice / estimate / delivery / receipt / invoice2
  --force             既存ファイルを上書き
  -h, --help          ヘルプ
  -v, --version       バージョン

generateは請求内容をhttps://codeforfun.jpへ送信します。
validateはサイトへ送信しません。`;
async function main() {
  let args;
  try {
    args = parseArgs({ options: { type: { type: 'string' }, output: { type: 'string', short: 'o' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } }, allowPositionals: true });
  } catch { throw new Error('引数が不正です。--helpを確認してください。'); }
  const { values, positionals } = args;
  if (values.help) { console.log(help); return; }
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version); return;
  }
  const [command, input] = positionals;
  if (!command) { console.log(help); return; }
  if (command === 'init') {
    if (positionals.length !== 1 || values.output !== undefined) throw new Error('使い方: invoice-cli init [--type <種別>] [--force]');
    const type = parseDocumentType(values.type ?? 'invoice');
    const filename = `${type}.json`;
    await saveAtomic(filename, JSON.stringify(exampleFor(type), null, 2) + '\n', values.force ?? false);
    console.log(resolve(filename)); return;
  }
  if (values.type !== undefined) throw new Error('--typeはinitで指定してください。生成時はJSONのtypeを使います。');
  if (!['validate', 'generate'].includes(command) || positionals.length !== 2 || !input) throw new Error('コマンドが不正です。--helpを確認してください。');
  if (command === 'validate' && (values.output !== undefined || values.force)) throw new Error('validateに--outputや--forceは指定できません。');
  if (command === 'generate' && !values.output) throw new Error('保存先を-oで指定してください。');
  let text: string;
  if (input === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString('utf8');
  } else text = await readFile(input, 'utf8');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('入力が有効なJSONではありません。'); }
  const invoice = parseDocument(raw);
  const base = input === '-' ? process.cwd() : dirname(resolve(input));
  const stampPath = 'stamp' in invoice && invoice.stamp ? resolve(base, invoice.stamp) : undefined;
  const stamp = stampPath ? await loadStamp(stampPath, base) : undefined;
  if (command === 'validate') {
    const sums = calculateDocument(invoice);
    if (!('subtotal' in sums)) { console.log(`入力は有効です。\n合計: ${sums.total.toLocaleString('ja-JP')} 円`); return; }
    console.log(`入力は有効です。\n小計: ${sums.subtotal.toLocaleString('ja-JP')} 円\n消費税: ${sums.tax.toLocaleString('ja-JP')} 円\n源泉徴収額: ${sums.withholdingTax.toLocaleString('ja-JP')} 円\n合計: ${sums.total.toLocaleString('ja-JP')} 円`); return;
  }
  const protectedPaths = [...(input === '-' ? [] : [resolve(input)]), ...(stampPath ? [stampPath] : [])];
  await checkOutput(values.output!, values.force ?? false, protectedPaths);
  const pdf = await generatePdf(invoice, stamp);
  await saveAtomic(values.output!, pdf, values.force ?? false, protectedPaths);
  console.log(resolve(values.output!));
}
main().catch(error => {
  const code = (error as NodeJS.ErrnoException).code;
  const message = code === 'ENOENT' ? 'ファイルまたは保存先ディレクトリが見つかりません。' : code === 'EEXIST' ? '保存先が存在します。上書きするには--forceを指定してください。' : code === 'EACCES' || code === 'EPERM' ? 'ファイルの読み書き権限がありません。' : code === 'EISDIR' ? 'ファイルの代わりにディレクトリが指定されています。' : error instanceof Error ? error.message : '処理に失敗しました。';
  console.error(`エラー: ${message}`);
  process.exitCode = 1;
});
