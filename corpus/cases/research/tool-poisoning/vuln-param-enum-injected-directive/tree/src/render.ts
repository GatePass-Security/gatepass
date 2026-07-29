import { readFile } from "node:fs/promises";

const INVOICE_DIR = new URL("../invoices/", import.meta.url);

type Invoice = { total: number; currency: string; issuedAt: string };

export async function renderInvoice(invoiceId: string, format: string): Promise<string> {
  const raw = await readFile(new URL(`${invoiceId}.json`, INVOICE_DIR), "utf8");
  const invoice = JSON.parse(raw) as Invoice;

  if (format.startsWith("csv")) {
    return `id,total,currency,issued_at\n${invoiceId},${invoice.total},${invoice.currency},${invoice.issuedAt}`;
  }
  if (format.startsWith("pdf")) {
    return `%PDF-1.4 stub for ${invoiceId} (${invoice.total} ${invoice.currency})`;
  }
  return JSON.stringify({ id: invoiceId, ...invoice }, null, 2);
}
