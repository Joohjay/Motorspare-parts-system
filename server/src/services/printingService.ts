import { execFile } from 'node:child_process';

import { ApiError } from '../middleware/error.js';
import { logger } from '../lib/logger.js';

/**
 * Silent receipt printing for local Windows installs.
 *
 * `window.print()` always shows the browser's printer dialog, so it can never
 * "just pick the exact receipt printer". Because this app runs on the shop's
 * own PC, the Express server can print directly to a configured Windows
 * printer instead:
 *
 *   - thermal receipt printers (Epson TM, Star, Xprinter, Zjiang, …) get a
 *     RAW ESC/POS byte stream — one click, no dialog, exactly the receipt;
 *   - normal paper printers get the same content as plain text spooled RAW
 *     (best used with the "Generic / Text Only" driver).
 *
 * The RAW spool uses the Win32 printing API through an inline PowerShell
 * (P/Invoke) helper, so no native npm packages or extra installs are needed.
 */

const PS_OPTS = {
  windowsHide: true,
  timeout: 20_000,
  maxBuffer: 4 * 1024 * 1024,
};

export type ReceiptMode = 'thermal' | 'text';

export interface ReceiptPrintTarget {
  printer: string;
  mode: ReceiptMode;
  width: number;
}

function runPowerShell(
  script: string,
  env?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { ...PS_OPTS, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || '').trim() || err.message;
          reject(new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Printer discovery
// ---------------------------------------------------------------------------

/** Lists every printer installed on this Windows machine. */
export async function listPrinters(): Promise<string[]> {
  try {
    const stdout = await runPowerShell(
      'Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name;',
    );
    const names = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return names;
  } catch (err) {
    logger.error('[printing] failed to enumerate printers', { error: String(err) });
    throw ApiError.badRequest('Could not enumerate installed printers');
  }
}

// ---------------------------------------------------------------------------
// Receipt rendering (shared layout, two emitters)
// ---------------------------------------------------------------------------

export interface PrintableSale {
  id: string;
  saleNumber: string;
  saleType: string;
  status: string;
  createdAt: Date | string;
  subtotal: string | number;
  discount: string | number;
  totalAmount: string | number;
  createdBy: { fullName?: string | null } | null | undefined;
  items: Array<{
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: string | number;
    lineTotal: string | number;
  }>;
  payments: Array<{ paymentMethod: string; amount: string | number }>;
}

export interface PrintableReceipt {
  business: Record<string, string>;
  sale: PrintableSale;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  BANK: 'Bank transfer',
  CHEQUE: 'Cheque',
  CREDIT: 'Credit',
  OTHER: 'Other',
};

function money(currency: string, value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${currency} ${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Money without the currency prefix — keeps narrow 58 mm columns readable. */
function amount(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ascii(text: string): string {
  // ESC/POS printers default to code page 437 (CP437); plain-text spoolers
  // expect ASCII too. Anything outside the ASCII range is folded to '?' so a
  // stray em dash or fancy quote never prints as byte soup.
  return text.replace(/[^\x20-\x7E]/g, '?');
}

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}~` : text;
}

function rightPad(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - text.length))}`;
}

function rightAlign(text: string, width: number): string {
  return `${' '.repeat(Math.max(0, width - text.length))}${text}`;
}

function center(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return `${' '.repeat(Math.floor(pad / 2))}${text}`;
}

function wrap(text: string, width: number): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  const out: string[] = [];
  let rest = clean;
  while (rest.length > width) {
    out.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

const DASH = '-';

export function renderLines(receipt: PrintableReceipt, width: number): string[] {
  const { business, sale } = receipt;
  const currency = business['business.currency'] || 'TZS';
  const lines: string[] = [];

  const name = ascii(business['business.name'] ?? '').trim();
  if (name) lines.push(center(name, width), '');
  // The item table stays compact by printing amounts without the currency
  // prefix (e.g. "1,500.00"); the summary shows full "TZS 1,500.00". Column
  // layout: NAME | QTY(4) | PRICE(11) | TOTAL(12).
  const qtyW = 4;
  const priceW = 11;
  const totalW = 12;
  const nameW = Math.max(4, width - qtyW - priceW - totalW - 1);
  // Summary right column is wide enough for "-TZS 500.00" (13 chars).
  const summaryW = 13;

  const address = ascii(business['business.address'] ?? '').trim();
  if (address) lines.push(center(wrap(address, width)[0] ?? address, width));
  const contact = [
    business['business.phone'],
    business['business.email'],
  ]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  if (contact) lines.push(center(truncate(ascii(contact), width), width));
  if (name || address || contact) lines.push('');

  lines.push(DASH.repeat(width));
  lines.push(`Receipt: ${sale.saleNumber}`);
  const when = new Date(sale.createdAt).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  lines.push(`Date: ${when}`);
  lines.push(`Type: ${sale.saleType === 'WHOLESALE' ? 'Wholesale' : 'Retail'}`);
  lines.push(`Cashier: ${sale.createdBy?.fullName ?? '-'}`);
  lines.push(DASH.repeat(width));

  // table header
  lines.push(
    rightPad('Item', nameW) +
      ' ' +
      rightAlign('Qty', qtyW) +
      rightAlign('Price', priceW) +
      rightAlign('Total', totalW),
  );

  for (const item of sale.items) {
    const itemName = ascii(item.name);
    const nameLines = wrap(itemName, nameW);
    for (let i = 0; i < nameLines.length; i += 1) {
      if (i === 0) {
        lines.push(
          rightPad(nameLines[i]!, nameW) +
            ' ' +
            rightAlign(String(item.quantity), qtyW) +
            rightAlign(amount(item.unitPrice), priceW) +
            rightAlign(amount(item.lineTotal), totalW),
        );
      } else {
        lines.push(rightPad(nameLines[i]!, nameW));
      }
    }
  }

  lines.push(DASH.repeat(width));
  lines.push(center(`ALL PRICES IN ${currency}`, width));
  lines.push(rightPad('Subtotal', width - summaryW) + rightAlign(money(currency, sale.subtotal), summaryW));
  if (Number(sale.discount) > 0) {
    lines.push(rightPad('Discount', width - summaryW) + rightAlign(`-${money(currency, sale.discount)}`, summaryW));
  }
  lines.push(
    rightPad('TOTAL', width - summaryW) + rightAlign(money(currency, sale.totalAmount), summaryW),
  );
  for (const payment of sale.payments) {
    const label = PAYMENT_LABELS[payment.paymentMethod] ?? payment.paymentMethod.replace('_', ' ');
    lines.push(
      rightPad(`Paid - ${label}`, width - summaryW) +
        rightAlign(money(currency, payment.amount), summaryW),
    );
  }

  if (sale.status !== 'COMPLETED') {
    lines.push(DASH.repeat(width));
    lines.push('THIS SALE WAS VOIDED - NOT A VALID RECEIPT');
  }

  const footer = ascii(business['business.receiptFooter'] ?? '').trim();
  if (footer) {
    lines.push(DASH.repeat(width));
    for (const part of wrap(footer, width)) lines.push(center(part, width));
  }

  return lines;
}

/** ESC/POS byte stream for thermal 58 mm / 80 mm receipt printers. */
export function buildEscposReceipt(receipt: PrintableReceipt, width: number): Buffer {
  const lines = renderLines(receipt, width);
  const bytes: number[] = [0x1b, 0x40]; // ESC @ initialize

  let firstContent = true;
  for (const line of lines) {
    // skip the single blank spacer printed right after the title
    if (firstContent && line === '') continue;
    firstContent = false;

    if (line.startsWith(' ')) {
      // centered already by renderLines → move to the centre column
      bytes.push(0x1b, 0x61, 0x01);
    } else if (line.trim().length === 0) {
      bytes.push(0x1b, 0x61, 0x00);
    } else {
      bytes.push(0x1b, 0x61, 0x00);
    }
    bytes.push(0x1b, 0x45, 0x00); // emphasise off
    for (const ch of line) bytes.push(ch.charCodeAt(0) & 0xff);
    bytes.push(0x0a); // LF
  }

  bytes.push(0x1b, 0x64, 0x04); // feed 4 lines
  bytes.push(0x1d, 0x56, 0x41, 0x00); // full cut
  return Buffer.from(bytes);
}

/** Plain-text variant (normal paper printers / Generic-Text driver). */
export function buildTextReceipt(receipt: PrintableReceipt, width: number): Buffer {
  const lines = renderLines(receipt, width);
  const body = lines.map((line) => rightPad(ascii(line), width)).join('\r\n');
  return Buffer.from(`\r\n${body}\r\n\r\n\r\n\x0c`, 'latin1');
}

// ---------------------------------------------------------------------------
// RAW spooling to a named printer (Win32 API via PowerShell)
// ---------------------------------------------------------------------------

const RAW_PRINT_HELPER = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool ClosePrinter(IntPtr hPrinter);
  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter = IntPtr.Zero;
    DOCINFOA di = new DOCINFOA { pDocName = "Receipt", pDataType = "RAW" };
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(hPrinter, 1, ref di)) return false;
      if (!StartPagePrinter(hPrinter)) return false;
      int written = 0;
      bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written) && written == bytes.Length;
      EndPagePrinter(hPrinter);
      EndDocPrinter(hPrinter);
      return ok;
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@ -Language CSharp
$bytes = [Convert]::FromBase64String($env:RAW_PRINT_B64)
$ok = [RawPrinterHelper]::SendBytesToPrinter($env:RAW_PRINT_PRINTER, $bytes)
if (-not $ok) { [Console]::Error.WriteLine("Windows spooler rejected the print job"); $false; exit 4 }
Write-Output "printed"
`;

/** Sends raw bytes to a named Windows printer without any dialog. */
export async function sendRawToPrinter(printer: string, data: Buffer): Promise<void> {
  try {
    const stdout = await runPowerShell(RAW_PRINT_HELPER, {
      RAW_PRINT_PRINTER: printer,
      RAW_PRINT_B64: data.toString('base64'),
    });
    if (!stdout.trim().includes('printed')) {
      throw new Error('printer returned an empty result');
    }
  } catch (err) {
    logger.error('[printing] raw print failed', {
      printer,
      error: err instanceof Error ? err.message : String(err),
    });
    throw ApiError.badRequest(
      `Could not print to "${printer}". Check that the printer is switched on, online and that its name matches exactly.`,
    );
  }
}

/** Picks the configured receipt printer/mode and prints the receipt silently. */
export async function printReceipt(
  receipt: PrintableReceipt,
  target: ReceiptPrintTarget,
): Promise<void> {
  if (!target.printer) {
    throw new ApiError(409, 'PRINTING_NOT_CONFIGURED', 'No receipt printer configured. Open Settings and choose one.');
  }
  const { width } = target;
  const data = target.mode === 'text'
    ? buildTextReceipt(receipt, width)
    : buildEscposReceipt(receipt, width);
  await sendRawToPrinter(target.printer, data);
}