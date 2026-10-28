import { parseInvoice, calculate, example, type Invoice, type Item } from './invoice.js';

export const documentTypes = ['invoice', 'estimate', 'delivery', 'receipt', 'invoice2'] as const;
export type DocumentType = typeof documentTypes[number];
export type QualifiedItem = Item & { taxRate: 8 | 10 | 'exempt'; withholding: boolean };
export type ItemDocument = Invoice & {
  type: 'invoice' | 'estimate' | 'delivery';
  documentNumber?: string;
  documentDate?: string;
  registrationNumber?: string;
};
export type QualifiedInvoice = Omit<ItemDocument, 'type' | 'items'> & { type: 'invoice2'; items: QualifiedItem[] };
export interface Receipt {
  type: 'receipt'; to: string; fromAddress: string; toAddress?: string;
  documentNumber?: string; documentDate?: string; subject?: string;
  total: number; netAmount?: number; details?: string; taxDescription?: string;
  layout: 'portrait' | 'landscape';
}
export type Document = ItemDocument | QualifiedInvoice | Receipt;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('入力はオブジェクトにしてください。');
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`未知のキー「${key}」です。この帳票には指定できません。`);
}
const common = ['type', 'to', 'fromAddress', 'toAddress', 'documentNumber', 'documentDate', 'subject'];
function safe(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('計算結果が安全な整数の範囲を超えています。');
  return Number(value);
}
export function parseDocumentType(value: string): DocumentType {
  if (!(documentTypes as readonly string[]).includes(value)) throw new Error(`帳票種別は${documentTypes.join(', ')}から指定してください。`);
  return value as DocumentType;
}
export function parseDocument(value: unknown): Document {
  const raw = record(value);
  const type = raw.type === undefined ? 'invoice' : parseDocumentType(raw.type as string);
  const { type: ignored, ...data } = raw;
  if (type === 'invoice') return { ...parseInvoice(data), type };
  if (type === 'receipt') {
    onlyKeys(raw, [...common, 'total', 'netAmount', 'details', 'taxDescription', 'layout']);
    const fields = ['documentNumber', 'documentDate', 'details', 'taxDescription', 'subject', 'toAddress'];
    for (const key of fields) if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`${key}は文字列にしてください。`);
    parseInvoice({ to: raw.to, fromAddress: raw.fromAddress, invoiceDate: raw.documentDate, items: [{ name: '検証用', unitPrice: 0, quantity: 1 }] });
    for (const key of ['total', 'netAmount']) {
      if (key === 'netAmount' && raw[key] === undefined) continue;
      if (typeof raw[key] !== 'number' || !Number.isSafeInteger(raw[key]) || raw[key] < 0) throw new Error(`${key}は0以上の安全な整数にしてください。`);
    }
    if (raw.layout !== undefined && raw.layout !== 'portrait' && raw.layout !== 'landscape') throw new Error('layoutはportraitまたはlandscapeにしてください。');
    return { ...raw, type, layout: raw.layout ?? 'portrait' } as unknown as Receipt;
  }
  if (type === 'estimate' || type === 'delivery') {
    onlyKeys(raw, [...common, 'items', 'taxEnabled', 'note']);
    const { documentNumber, documentDate, ...rest } = data;
    const parsed = parseInvoice({ ...rest, invoiceNumber: documentNumber, invoiceDate: documentDate, taxRate: 10 });
    return { ...parsed, type, documentNumber: parsed.invoiceNumber, documentDate: parsed.invoiceDate };
  }
  onlyKeys(raw, ['type', 'to', 'fromAddress', 'toAddress', 'invoiceNumber', 'invoiceDate', 'dueDate', 'subject', 'items', 'registrationNumber', 'bankDetails', 'note', 'stamp']);
  if (typeof raw.registrationNumber !== 'string' || !raw.registrationNumber.trim()) throw new Error('registrationNumberは必須の文字列です。');
  if (!Array.isArray(raw.items)) throw new Error('itemsは1〜10件にしてください。');
  const items = raw.items.map((value, index) => {
    const item = record(value);
    onlyKeys(item, ['name', 'unitPrice', 'quantity', 'taxRate', 'withholding']);
    if (item.taxRate !== undefined && ![8, 10, 'exempt'].includes(item.taxRate as string | number)) throw new Error(`items[${index}].taxRateは8、10、exemptから指定してください。`);
    if (item.withholding !== undefined && typeof item.withholding !== 'boolean') throw new Error(`items[${index}].withholdingは真偽値にしてください。`);
    return { ...item, taxRate: item.taxRate ?? 10, withholding: item.withholding ?? false } as QualifiedItem;
  });
  const { registrationNumber, ...rest } = data;
  const parsed = parseInvoice({ ...rest, taxEnabled: false, items: items.map(({ name, unitPrice, quantity }) => ({ name, unitPrice, quantity })) });
  const doc = { ...parsed, type: 'invoice2', registrationNumber: registrationNumber as string, items } satisfies QualifiedInvoice;
  calculateDocument(doc);
  return doc;
}
type ItemTotals = ReturnType<typeof calculate>;
type QualifiedTotals = ItemTotals & { sum10: number; sum8: number; tax10: number; tax8: number };
export function calculateDocument(doc: Document): ItemTotals | QualifiedTotals | { total: number } {
  if (doc.type === 'receipt') return { total: doc.total };
  if (doc.type !== 'invoice2') return calculate(doc);
  const items = doc.items;
  const amounts = items.map(item => BigInt(item.unitPrice) * BigInt(item.quantity));
  let sum10 = 0n, sum8 = 0n, withholdingBase = 0n;
  items.forEach((item, index) => {
    const amount = amounts[index]!;
    if (item.taxRate === 10) sum10 += amount;
    if (item.taxRate === 8) sum8 += amount;
    if (item.withholding) withholdingBase += amount;
  });
  const tax10 = sum10 * 10n / 100n, tax8 = sum8 * 8n / 100n;
  const withholdingTax = withholdingBase > 1000000n ? (withholdingBase - 1000000n) * 2042n / 10000n + 102100n : withholdingBase * 1021n / 10000n;
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0n);
  safe(subtotal + tax10 + tax8);
  return { amounts: amounts.map(safe), subtotal: safe(subtotal), tax: safe(tax10 + tax8), withholdingTax: safe(withholdingTax), total: safe(subtotal + tax10 + tax8 - withholdingTax), sum10: safe(sum10), sum8: safe(sum8), tax10: safe(tax10), tax8: safe(tax8) };
}
export function exampleFor(type: DocumentType) {
  if (type === 'invoice') return example;
  if (type === 'receipt') return { type, to: example.to, toAddress: example.toAddress, fromAddress: example.fromAddress, documentNumber: 'REC-001', documentDate: example.invoiceDate, total: 110000, netAmount: 100000, subject: '開発費として', details: '銀行振込', taxDescription: '10%', layout: 'portrait' };
  if (type === 'invoice2') {
    const { taxEnabled, taxRate, withholdingTax, ...rest } = example;
    return { ...rest, type, registrationNumber: 'T0000000000000', items: [{ ...example.items[0], taxRate: 10, withholding: false }] };
  }
  return { type, to: example.to, toAddress: example.toAddress, fromAddress: example.fromAddress, documentNumber: type === 'estimate' ? 'EST-001' : 'DEL-001', documentDate: example.invoiceDate, subject: example.subject, items: example.items, taxEnabled: true, note: type === 'estimate' ? '有効期限：\n納期：\n支払条件：' : '' };
}
