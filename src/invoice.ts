export interface Item { name: string; unitPrice: number; quantity: number }
export interface Invoice {
  to: string; fromAddress: string; items: Item[];
  toAddress?: string; invoiceNumber?: string; invoiceDate?: string; dueDate?: string;
  subject?: string; bankDetails?: string; note?: string; stamp?: string;
  taxEnabled: boolean; taxRate: 8 | 10; withholdingTax: number;
}
const strings = ['to', 'fromAddress', 'toAddress', 'invoiceNumber', 'invoiceDate', 'dueDate', 'subject', 'bankDetails', 'note', 'stamp'];
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}はオブジェクトにしてください。`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: 未知のキー「${key}」です。`);
}
function integer(value: unknown, label: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}は${minimum}以上の安全な整数にしてください。`);
}
export function parseInvoice(value: unknown): Invoice {
  const v = object(value, '入力');
  keys(v, [...strings, 'items', 'taxEnabled', 'taxRate', 'withholdingTax'], '入力');
  for (const key of strings) {
    if (v[key] !== undefined && typeof v[key] !== 'string') throw new Error(`${key}は文字列にしてください。`);
  }
  for (const key of ['to', 'fromAddress']) if (typeof v[key] !== 'string' || !v[key].trim()) throw new Error(`${key}は必須です。`);
  if (v.stamp !== undefined && !(v.stamp as string).trim()) throw new Error('stampに画像パスを指定してください。');
  for (const key of ['invoiceDate', 'dueDate']) {
    const date = v[key] as string | undefined;
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error(`${key}は実在するYYYY-MM-DD形式の日付にしてください。`);
  }
  if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > 10) throw new Error('itemsは1〜10件にしてください。');
  v.items.forEach((value, index) => {
    const item = object(value, `items[${index}]`);
    keys(item, ['name', 'unitPrice', 'quantity'], `items[${index}]`);
    if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`items[${index}].nameは必須です。`);
    integer(item.unitPrice, `items[${index}].unitPrice`);
    integer(item.quantity, `items[${index}].quantity`, 1);
  });
  if (v.taxEnabled !== undefined && typeof v.taxEnabled !== 'boolean') throw new Error('taxEnabledは真偽値にしてください。');
  if (v.taxRate !== undefined && v.taxRate !== 8 && v.taxRate !== 10) throw new Error('taxRateは8または10にしてください。');
  integer(v.withholdingTax === undefined ? 0 : v.withholdingTax, 'withholdingTax');
  const invoice = { ...v, taxEnabled: v.taxEnabled ?? true, taxRate: v.taxRate ?? 10, withholdingTax: v.withholdingTax ?? 0 } as unknown as Invoice;
  calculate(invoice);
  return invoice;
}
export function calculate(invoice: Invoice) {
  const amounts = invoice.items.map(item => BigInt(item.unitPrice) * BigInt(item.quantity));
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0n);
  const tax = invoice.taxEnabled ? subtotal * BigInt(invoice.taxRate) / 100n : 0n;
  const gross = subtotal + tax;
  const total = gross - BigInt(invoice.withholdingTax);
  for (const amount of [...amounts, subtotal, tax, gross, total]) {
    if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('計算結果が安全な整数の範囲を超えています。');
  }
  return { amounts: amounts.map(Number), subtotal: Number(subtotal), tax: Number(tax), withholdingTax: invoice.withholdingTax, total: Number(total) };
}
export const example = {
  to: '株式会社サンプル 御中', toAddress: '東京都千代田区（架空住所）',
  invoiceNumber: 'INV-001', invoiceDate: '2026-10-28', dueDate: '2026-11-30',
  fromAddress: '東京都新宿区（架空住所）\n山田 太郎', subject: '開発費',
  items: [{ name: '開発作業', unitPrice: 100000, quantity: 1 }],
  taxEnabled: true, taxRate: 10, withholdingTax: 0, bankDetails: '○○銀行 ○○支店 普通 1234567', note: ''
};
