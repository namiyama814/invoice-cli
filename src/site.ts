import { calculate, type Invoice } from './invoice.js';
import { calculateDocument, type Document, type QualifiedInvoice } from './documents.js';
import type { loadStamp } from './files.js';
export const endpoint = 'https://codeforfun.jp/tools/invoice/invoice.php';
type Stamp = Awaited<ReturnType<typeof loadStamp>>;
const format = (value: number) => String(value).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
const yen = (value: number) => `${format(value)} 円`;
// The remote templates embed form values in TCPDF HTML without escaping them.
// Encode text once at this boundary so <...> and entities remain literal text.
const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function createForm(invoice: Invoice, stamp?: Stamp) {
  const form = new FormData();
  const amounts = calculate(invoice);
  const mapping = { to: 'to', toAddress: 'to_address', invoiceNumber: 'invoice_num', invoiceDate: 'invoice_date', dueDate: 'invoice_deadline', fromAddress: 'from_address', subject: 'subject', bankDetails: 'bank_detail', note: 'note' } as const;
  for (const [key, field] of Object.entries(mapping)) {
    let value = invoice[key as keyof typeof mapping] ?? '';
    if (key === 'invoiceDate' || key === 'dueDate') value = value.replaceAll('-', '/');
    form.append(field, escapeText(value));
  }
  form.append('hidden_tax_include', invoice.taxEnabled ? '1' : '2');
  form.append('hidden_tax_rate', String(invoice.taxRate));
  form.append('hidden_gensen_include', invoice.withholdingTax > 0 ? '1' : '2');
  invoice.items.forEach((item, index) => {
    form.append('item_name[]', escapeText(item.name));
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
export function documentEndpoint(doc: Invoice | Document) {
  const type = 'type' in doc ? doc.type : 'invoice';
  const script = type === 'invoice2' ? 'invoice' : type;
  return `https://codeforfun.jp/tools/${type}/${script}.php`;
}
export function createDocumentForm(doc: Invoice | Document, stamp?: Stamp) {
  if (!('type' in doc) || doc.type === 'invoice') return createForm(doc, stamp);
  const form = new FormData();
  const put = (key: string, value: string | number | undefined) => form.append(key, escapeText(String(value ?? '')));
  put('to', doc.to); put('to_address', doc.toAddress); put('from_address', doc.fromAddress); put('subject', doc.subject);
  if (doc.type === 'receipt') {
    put('receipt_num', doc.documentNumber); put('receipt_date', doc.documentDate?.replaceAll('-', '/'));
    put('total', format(doc.total)); put('no_tax', doc.netAmount === undefined ? '' : format(doc.netAmount));
    put('details', doc.details); put('tax', doc.taxDescription); put('layout', doc.layout === 'landscape' ? '2' : '1');
    return form;
  }
  const qualified = doc.type === 'invoice2';
  const prefix = qualified ? 'invoice' : doc.type;
  put(`${prefix}_num`, qualified ? doc.invoiceNumber : doc.documentNumber);
  put(`${prefix}_date`, (qualified ? doc.invoiceDate : doc.documentDate)?.replaceAll('-', '/'));
  put('note', doc.note);
  if (qualified) {
    put('invoice_deadline', doc.dueDate?.replaceAll('-', '/')); put('registration_number', doc.registrationNumber); put('bank_detail', doc.bankDetails);
    if (stamp) form.append('stamp', new Blob([new Uint8Array(stamp.data)], { type: stamp.type }), stamp.name);
  } else put('tax_include', doc.taxEnabled ? '1' : '2');
  const sums = calculateDocument(doc);
  if (!('amounts' in sums)) throw new Error('明細の計算に失敗しました。');
  doc.items.forEach((item, index) => {
    const reduced = qualified && (item as QualifiedInvoice['items'][number]).taxRate === 8;
    put('item_name[]', item.name + (reduced ? '　※' : '')); put('item_unit[]', format(item.unitPrice));
    put('item_qnt[]', format(item.quantity)); put('item_price[]', format(sums.amounts[index]!));
  });
  put('subtotal', yen(sums.subtotal)); put('tax', yen(sums.tax)); put('total', yen(sums.total)); put('format_total', yen(sums.total));
  if ('sum10' in sums) {
    put('gensen', `-${format(sums.withholdingTax)} 円`);
    put('sum_10', yen(sums.sum10)); put('tax_10', yen(sums.tax10)); put('sum_8', yen(sums.sum8)); put('tax_8', yen(sums.tax8));
  }
  return form;
}
export async function generatePdf(invoice: Invoice | Document, stamp?: Stamp, options: { url?: string; timeoutMs?: number } = {}) {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30000);
  try {
    const form = createDocumentForm(invoice, stamp);
    const simple = 'type' in invoice && ['estimate', 'delivery', 'receipt'].includes(invoice.type);
    const body = simple ? new URLSearchParams(Array.from(form.entries(), ([key, value]) => [key, String(value)])) : form;
    const response = await fetch(options.url ?? documentEndpoint(invoice), { method: 'POST', body, signal, redirect: 'error' });
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
