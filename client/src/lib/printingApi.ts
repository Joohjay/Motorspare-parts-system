import { apiRequest } from './api';

/**
 * Silent receipt printing. Instead of opening the browser's print dialog this
 * asks the local API server to spool the receipt straight to the configured
 * Windows printer (NPC thermal / ESC/POS printers silent & exact, normal
 * paper printers as RTF-free text).
 */
export interface PrintReceiptResult {
  printed: boolean;
  printer: string;
  mode: 'thermal' | 'text';
}

export const printingApi = {
  listPrinters(): Promise<{ printers: string[] }> {
    return apiRequest<{ printers: string[] }>('/printing/printers');
  },

  printReceipt(saleId: string): Promise<PrintReceiptResult> {
    return apiRequest<PrintReceiptResult>(`/printing/receipt/${saleId}`, {
      method: 'POST',
    });
  },
};