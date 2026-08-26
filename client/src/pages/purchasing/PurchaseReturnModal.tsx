import { useState } from 'react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/Button';
import {
  Field,
  FormError,
  SelectInput,
  TextArea,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { purchaseReturnsApi } from '@/lib/stage8Api';
import type { PaymentMethod, Purchase, PurchaseReturn } from '@/types/api';

interface ReturnLineDraft {
  purchaseItemId: string;
  name: string;
  sku: string;
  quantityAccepted: number;
  quantity: number;
}

/**
 * Stage 8 — return items from a completed purchase back to the supplier.
 * Stock leaves inventory at the current weighted-average cost; the supplier
 * is settled at the frozen purchase unit cost, optionally reducing an open
 * supplier-credit balance.
 */
export function PurchaseReturnModal({
  purchase,
  onClose,
  onDone,
}: {
  purchase: Purchase;
  onClose: () => void;
  onDone: (purchaseReturn: PurchaseReturn) => void;
}): ReactElement {
  const returnable = purchase.items.filter((item) => item.quantityAccepted > 0);

  const [lines, setLines] = useState<ReturnLineDraft[]>(
    returnable.map((item) => ({
      purchaseItemId: item.id,
      name: item.product.name,
      sku: item.product.sku,
      quantityAccepted: item.quantityAccepted,
      quantity: 0,
    })),
  );
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<'SUPPLIER_CREDIT' | 'REFUND' | 'NONE'>('SUPPLIER_CREDIT');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod | ''>('');
  const [refundReference, setRefundReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalQuantity = lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
  const estimatedTotal = lines.reduce((sum, line) => {
    const item = purchase.items.find((candidate) => candidate.id === line.purchaseItemId);
    if (!item || !Number.isFinite(line.quantity)) return sum;
    return sum + Number(item.unitCost) * line.quantity;
  }, 0);

  const submit = async () => {
    setError(null);
    if (totalQuantity <= 0) {
      setError('Enter at least one quantity to return.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('A reason is required for the return.');
      return;
    }
    if (settlement === 'REFUND' && refundMethod === '') {
      setError('Choose the refund method.');
      return;
    }

    setBusy(true);
    try {
      const response = await purchaseReturnsApi.create(purchase.id, {
        items: lines
          .filter((line) => line.quantity > 0)
          .map((line) => ({ purchaseItemId: line.purchaseItemId, quantity: line.quantity })),
        reason: reason.trim(),
        settlement,
        ...(settlement === 'REFUND'
          ? { refundMethod: refundMethod as PaymentMethod, refundReference: refundReference.trim() || null }
          : {}),
      });
      onDone(response.return);
    } catch (err) {
      setError(errorMessage(err, 'Could not record the return'));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Return items — ${purchase.purchaseNumber}`} onClose={onClose} className="max-w-2xl">
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          Returning stock lowers inventory immediately. The supplier is settled at each line's original
          purchase cost.
        </p>

        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 font-medium">Product</th>
              <th className="py-2 text-right font-medium">Accepted</th>
              <th className="py-2 text-right font-medium">Return qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line, index) => (
              <tr key={line.purchaseItemId}>
                <td className="py-2">
                  <div className="text-slate-900">{line.name}</div>
                  <div className="font-mono text-xs text-slate-500">{line.sku}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{line.quantityAccepted}</td>
                <td className="py-2 text-right">
                  <TextInput
                    type="number"
                    min={0}
                    max={line.quantityAccepted}
                    value={String(line.quantity)}
                    aria-label={`Return quantity for ${line.name}`}
                    className="w-20 text-right"
                    onChange={(event) => {
                      const raw = event.target.value === '' ? 0 : Number(event.target.value);
                      const clamped = Math.max(0, Math.min(line.quantityAccepted, Math.floor(raw)));
                      setLines((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index ? { ...candidate, quantity: clamped } : candidate,
                        ),
                      );
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-right text-sm">
          Estimated return value:{' '}
          <span className="font-semibold tabular-nums">TZS {estimatedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </p>

        <Field label="Reason" htmlFor="purchase-return-reason" required>
          <TextArea
            id="purchase-return-reason"
            rows={2}
            placeholder="Why are these items being returned?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <Field label="Settlement" htmlFor="purchase-return-settlement" hint="How the supplier gives this money back.">
          <SelectInput
            id="purchase-return-settlement"
            value={settlement}
            onChange={(event) => setSettlement(event.target.value as typeof settlement)}
          >
            <option value="SUPPLIER_CREDIT">Reduce supplier credit balance</option>
            <option value="REFUND">Cash / mobile-money refund now</option>
            <option value="NONE">No immediate settlement</option>
          </SelectInput>
        </Field>

        {settlement === 'REFUND' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Refund method" htmlFor="purchase-return-refund-method" required>
              <SelectInput
                id="purchase-return-refund-method"
                value={refundMethod}
                onChange={(event) => setRefundMethod(event.target.value as PaymentMethod | '')}
              >
                <option value="">Choose…</option>
                <option value="CASH">Cash</option>
                <option value="MPESA">M-Pesa</option>
                <option value="AIRTEL_MONEY">Airtel Money</option>
                <option value="BANK">Bank transfer</option>
                <option value="OTHER">Other</option>
              </SelectInput>
            </Field>
            <Field label="Reference (optional)" htmlFor="purchase-return-refund-reference">
              <TextInput
                id="purchase-return-refund-reference"
                value={refundReference}
                onChange={(event) => setRefundReference(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <FormError message={error} />

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy || totalQuantity <= 0}>
            {busy ? 'Recording…' : `Record return${totalQuantity > 0 ? ` (${totalQuantity})` : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
