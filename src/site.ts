import { calculate, type Invoice } from './invoice.js';
import type { loadStamp } from './files.js';
export const endpoint = 'https://codeforfun.jp/tools/invoice/invoice.php';
type Stamp = Awaited<ReturnType<typeof loadStamp>>;
const format = (value: number) => String(value).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
const yen = (value: number) => `${format(value)} 円`;
export function createForm(invoice: Invoice, stamp?: Stamp) {
  const form = new FormData();
  const amounts = calculate(invoice);
  const mapping = { to: 'to', toAddress: 'to_address', invoiceNumber: 'invoice_num', invoiceDate: 'invoice_date', dueDate: 'invoice_deadline', fromAddress: 'from_address', subject: 'subject', bankDetails: 'bank_detail', note: 'note' } as const;
  for (const [key, field] of Object.entries(mapping)) {
    let value = invoice[key as keyof typeof mapping] ?? '';
    if (key === 'invoiceDate' || key === 'dueDate') value = value.replaceAll('-', '/');
    form.append(field, value);
  }
  form.append('hidden_tax_include', invoice.taxEnabled ? '1' : '2');
  form.append('hidden_tax_rate', String(invoice.taxRate));
  form.append('hidden_gensen_include', invoice.withholdingTax > 0 ? '1' : '2');
  invoice.items.forEach((item, index) => {
    form.append('item_name[]', item.name);
    form.append('item_unit[]', format(item.unitPrice));
    form.append('item_qnt[]', format(item.quantity));
    form.append('item_price[]', format(amounts.amounts[index]!));
  });
  form.append('subtotal', yen(amounts.subtotal));
  form.append('tax', yen(amounts.tax));
  form.append('format_tax_withholding', yen(-amounts.withholdingTax));
  form.append('total', yen(amounts.total));
  form.append('format_total', yen(amounts.total));
  if (stamp) form.append('stamp', new Blob([new Uint8Array(stamp.data)], { type: stamp.type }), stamp.name);
  return form;
}
export async function generatePdf(invoice: Invoice, stamp?: Stamp, options: { url?: string; timeoutMs?: number } = {}) {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30000);
  try {
    const response = await fetch(options.url ?? endpoint, { method: 'POST', body: createForm(invoice, stamp), signal, redirect: 'error' });
    if (!response.ok) throw new Error(`サイトがHTTP ${response.status}を返しました。`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('サイトからPDF以外の応答が返されました。');
    return data;
  } catch (error) {
    if (signal.aborted) throw new Error('PDF生成が30秒以内に完了しませんでした。');
    if (error instanceof TypeError) throw new Error('サイトへの接続に失敗しました。通信環境を確認してください。');
    throw error;
  }
}
