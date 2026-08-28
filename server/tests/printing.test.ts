import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildEscposReceipt,
  buildTextReceipt,
  renderLines,
} from '../src/services/printingService.js';
import type { PrintableReceipt } from '../src/services/printingService.js';

const RECEIPT: PrintableReceipt = {
  business: {
    'business.name': 'JM SPAREPARTS',
    'business.address': 'Market Street, Arusha',
    'business.phone': '+255 700 000 000',
    'business.currency': 'TZS',
    'business.receiptFooter': 'Thank you for shopping with JM SPAREPARTS',
  },
  sale: {
    id: 'sale_1',
    saleNumber: 'SALE-000001',
    saleType: 'RETAIL',
    status: 'COMPLETED',
    createdAt: new Date('2026-08-27T14:30:00.000Z'),
    subtotal: '5000.00',
    discount: '500.00',
    totalAmount: '4500.00',
    createdBy: { fullName: 'Admin User' },
    items: [
      {
        name: 'Brake Pad Boxer 150',
        sku: 'BP-BOX-150',
        quantity: 2,
        unitPrice: '1500.00',
        lineTotal: '3000.00',
      },
      {
        name: 'Drive Chain 150',
        sku: 'CHAIN-150',
        quantity: 1,
        unitPrice: '2500.00',
        lineTotal: '2500.00',
      },
    ],
    payments: [{ paymentMethod: 'CASH', amount: '4500.00' }],
  },
};

describe('receipt rendering', () => {
  it('keeps every printed line inside the configured character width', () => {
    for (const width of [32, 42, 48]) {
      const lines = renderLines(RECEIPT, width);
      for (const line of lines) {
        assert.ok(line.length <= width, `line overflows width ${width}: "${line}" (${line.length})`);
      }
    }
  });

  it('includes business name, sale number and currency-formatted totals', () => {
    const lines = renderLines(RECEIPT, 42).join('\n');
    assert.match(lines, /JM SPAREPARTS/);
    assert.match(lines, /SALE-000001/);
    assert.match(lines, /TZS 4,500\.00/);
    assert.match(lines, /Paid - Cash/);
  });

  it('marks voided sales as invalid receipts', () => {
    const voided = {
      ...RECEIPT,
      sale: { ...RECEIPT.sale, status: 'VOID' },
    };
    const lines = renderLines(voided, 42).join('\n');
    assert.match(lines, /VOIDED/);
  });
});

describe('ESC/POS emission', () => {
  it('initializes the printer and cuts the paper at the end', () => {
    const buf = buildEscposReceipt(RECEIPT, 42);
    const bytes: number[] = [...buf];
    assert.deepEqual(bytes.slice(0, 2), [0x1b, 0x40]);
    assert.deepEqual(bytes.slice(-4), [0x1d, 0x56, 0x41, 0x00]);
  });
});

describe('plain-text emission', () => {
  it('contains the receipt text and ends with a form feed for paper ejects', () => {
    const buf = buildTextReceipt(RECEIPT, 42);
    const text = buf.toString('latin1');
    assert.match(text, /JM SPAREPARTS/);
    assert.match(text, /TZS 4,500\.00/);
    assert.ok(text.endsWith('\x0c'));
  });
});