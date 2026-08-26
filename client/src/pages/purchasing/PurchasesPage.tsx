import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  SelectInput,
  TextArea,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { PurchaseReturnModal } from '@/pages/purchasing/PurchaseReturnModal';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { ApiClientError } from '@/lib/api';
import { productsApi } from '@/lib/catalogApi';
import {
  paymentStatusLabels,
  purchaseOrdersApi,
  purchasesApi,
  suppliersApi,
} from '@/lib/purchasingApi';
import type { Purchase, PurchaseOrder, Supplier } from '@/types/api';

const PAGE_SIZE = 25;

interface PoLineDraft {
  purchaseOrderItemId: string;
  productId: string;
  productName: string;
  remaining: number;
  quantityReceived: string;
  quantityDamaged: string;
  quantityMissing: string;
}

function formatMoney(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `TZS ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function PurchasesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [paymentStatus, setPaymentStatus] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Purchase[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [detail, setDetail] = useState<Purchase | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    purchasesApi
      .list({
        paymentStatus: paymentStatus || undefined,
        page,
        pageSize: PAGE_SIZE,
        sortBy: 'receivedAt',
        sortOrder: 'desc',
      })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotalPages(data.pagination.totalPages);
        setTotalItems(data.pagination.totalItems);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load purchases. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [paymentStatus, page, reloadTick]);

  async function openDetail(purchase: Purchase) {
    setDetailLoading(true);
    setActionError(null);
    try {
      const full = await purchasesApi.get(purchase.id);
      setDetail(full.purchase);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to load the receipt.');
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Receiving</h1>
          <p className="mt-1 text-sm text-slate-500">
            Goods received into stock from suppliers.
          </p>
        </div>
        {isAdmin && <Button onClick={() => setReceiveOpen(true)}>Receive stock</Button>}
      </div>

      <nav className="flex gap-4 text-sm text-slate-500">
        <Link to="/purchasing/purchase-orders" className="hover:text-brand-600">
          Orders
        </Link>
        <span className="font-medium text-brand-600">Receiving</span>
        <Link to="/purchasing/suppliers" className="hover:text-brand-600">
          Suppliers
        </Link>
        <Link to="/purchasing/credit" className="hover:text-brand-600">
          Credit
        </Link>
      </nav>

      {success && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <Card className="p-4">
        <Field label="Payment status" htmlFor="purchase-payment">
          <SelectInput
            id="purchase-payment"
            value={paymentStatus}
            className="max-w-xs"
            onChange={(e) => {
              setPaymentStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIAL">Partial</option>
            <option value="PAID">Paid</option>
          </SelectInput>
        </Field>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading receipts…" />
      ) : !items || items.length === 0 ? (
        <EmptyState message="No purchases match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
            {totalItems} receipt{totalItems === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Received at</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">{p.purchaseNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{p.supplier.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {p.purchaseOrder ? p.purchaseOrder.orderNumber : 'Direct'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatMoney(p.totalAmount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          p.paymentStatus === 'PAID'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : p.paymentStatus === 'PARTIAL'
                              ? 'bg-blue-50 text-blue-700 ring-blue-200'
                              : 'bg-amber-50 text-amber-700 ring-amber-200'
                        }`}
                      >
                        {paymentStatusLabels[p.paymentStatus] ?? p.paymentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(p.receivedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" onClick={() => void openDetail(p)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </Card>
      )}

      {(detail || detailLoading) && (
        <Modal title={detail ? `Receipt ${detail.purchaseNumber}` : 'Receipt'} onClose={() => setDetail(null)} className="max-w-2xl">
          {detailLoading || !detail ? (
            <LoadingState label="Loading receipt…" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <span className="text-slate-500">Supplier</span>
                <span className="text-slate-900">{detail.supplier.name}</span>
                <span className="text-slate-500">Source order</span>
                <span>{detail.purchaseOrder ? detail.purchaseOrder.orderNumber : 'Direct purchase'}</span>
                <span className="text-slate-500">Invoice reference</span>
                <span>{detail.invoiceReference ?? '—'}</span>
                <span className="text-slate-500">Total</span>
                <span className="tabular-nums">{formatMoney(detail.totalAmount)}</span>
                <span className="text-slate-500">Payment</span>
                <span>{paymentStatusLabels[detail.paymentStatus] ?? detail.paymentStatus}</span>
                <span className="text-slate-500">Received by</span>
                <span>{detail.createdBy ? detail.createdBy.fullName : '—'}</span>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 text-right font-medium">Received</th>
                    <th className="py-2 text-right font-medium">Accepted</th>
                    <th className="py-2 text-right font-medium">Damaged</th>
                    <th className="py-2 text-right font-medium">Missing</th>
                    <th className="py-2 text-right font-medium">Unit cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2">
                        <div className="text-slate-900">{i.product.name}</div>
                        <div className="font-mono text-xs text-slate-500">{i.product.sku}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{i.quantityReceived}</td>
                      <td className="py-2 text-right tabular-nums">{i.quantityAccepted}</td>
                      <td className="py-2 text-right tabular-nums">{i.quantityDamaged}</td>
                      <td className="py-2 text-right tabular-nums">{i.quantityMissing}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(i.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.notes && <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">{detail.notes}</p>}
              {isAdmin && detail.status === 'COMPLETED' ? (
                <div className="flex justify-end border-t border-slate-100 pt-3">
                  <Button variant="danger" onClick={() => setReturning(true)}>
                    Return items to supplier
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      )}

      {returning && detail && (
        <PurchaseReturnModal
          purchase={detail}
          onClose={() => setReturning(false)}
          onDone={(purchaseReturn) => {
            setReturning(false);
            setDetail(null);
            setSuccess(`Return recorded — ${purchaseReturn.returnNumber}. Inventory and supplier credit updated.`);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {receiveOpen && (
        <ReceiveModal
          onClose={() => setReceiveOpen(false)}
          onDone={(number) => {
            setReceiveOpen(false);
            setSuccess(`Stock received — ${number} recorded and inventory updated.`);
            setReloadTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

function ReceiveModal({ onClose, onDone }: { onClose: () => void; onDone: (purchaseNumber: string) => void }) {
  const [mode, setMode] = useState<'PO' | 'DIRECT'>('PO');

  const [openOrders, setOpenOrders] = useState<PurchaseOrder[]>([]);
  const [orderId, setOrderId] = useState('');
  const [orderLines, setOrderLines] = useState<PoLineDraft[]>([]);
  const [invoiceReference, setInvoiceReference] = useState('');
  const [notes, setNotes] = useState('');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [directSupplierId, setDirectSupplierId] = useState('');
  const [directLines, setDirectLines] = useState([
    { productId: '', quantityOrdered: '', quantityReceived: '', unitCost: '' },
  ]);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      purchaseOrdersApi.list({ status: 'PENDING', pageSize: 100 }),
      purchaseOrdersApi.list({ status: 'PARTIALLY_RECEIVED', pageSize: 100 }),
    ])
      .then(([a, b]) => setOpenOrders([...a.items, ...b.items]))
      .catch(() => undefined);
    suppliersApi
      .list({ status: 'ACTIVE', pageSize: 500 })
      .then((data) => setSuppliers(data.items))
      .catch(() => undefined);
  }, []);

  async function pickOrder(id: string) {
    setOrderId(id);
    setOrderLines([]);
    if (!id) return;
    try {
      const full = await purchaseOrdersApi.get(id);
      setOrderLines(
        (full.purchaseOrder.items ?? [])
          .filter((i) => i.remaining > 0)
          .map((i) => ({
            purchaseOrderItemId: i.id,
            productId: i.productId,
            productName: `${i.product.sku} — ${i.product.name}`,
            remaining: i.remaining,
            quantityReceived: '',
            quantityDamaged: '',
            quantityMissing: '',
          })),
      );
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Unable to load the order lines.');
    }
  }

  function setOrderLine(index: number, patch: Partial<PoLineDraft>) {
    setOrderLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function setDirectLine(index: number, patch: Partial<(typeof directLines)[number]>) {
    setDirectLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setFormError(null);
    interface ApiLine {
      purchaseOrderItemId?: string;
      productId: string;
      quantityReceived: number;
      quantityDamaged?: number;
      quantityMissing?: number;
      unitCost?: number;
      quantityOrdered?: number;
    }
    const apiLines: ApiLine[] = [];

    if (mode === 'PO') {
      for (const line of orderLines) {
        const received = Number(line.quantityReceived || 0);
        const damaged = Number(line.quantityDamaged || 0);
        const missing = Number(line.quantityMissing || 0);
        if (!received && !damaged && !missing) continue;
        if (received <= 0) {
          setFormError(`Enter a positive received quantity for ${line.productName}.`);
          return;
        }
        if (received > line.remaining) {
          setFormError(`${line.productName}: cannot receive more than the ${line.remaining} remaining.`);
          return;
        }
        apiLines.push({
          purchaseOrderItemId: line.purchaseOrderItemId,
          productId: line.productId,
          quantityReceived: received,
          quantityDamaged: damaged || undefined,
          quantityMissing: missing || undefined,
        });
      }
      if (apiLines.length === 0) {
        setFormError('Enter quantities for at least one line.');
        return;
      }
    } else {
      for (const line of directLines) {
        if (!line.productId && !line.quantityReceived) continue;
        const ordered = Number(line.quantityOrdered);
        const received = Number(line.quantityReceived);
        const cost = Number(line.unitCost);
        if (!line.productId || !Number.isFinite(received) || received <= 0 || !Number.isFinite(cost)) {
          setFormError('Each direct line needs a product, a positive received quantity and a unit cost.');
          return;
        }
        apiLines.push({
          productId: line.productId,
          quantityReceived: received,
          quantityOrdered: Number.isFinite(ordered) && ordered > 0 ? ordered : received,
          unitCost: cost,
        });
      }
      if (apiLines.length === 0) {
        setFormError('Add at least one line.');
        return;
      }
      if (!directSupplierId) {
        setFormError('Choose a supplier.');
        return;
      }
    }

    setBusy(true);
    try {
      const payload =
        mode === 'PO'
          ? { purchaseOrderId: orderId, invoiceReference: invoiceReference.trim() || null, notes: notes.trim() || null, items: apiLines }
          : { supplierId: directSupplierId, invoiceReference: invoiceReference.trim() || null, notes: notes.trim() || null, items: apiLines };
      const result = await purchasesApi.receive(payload);
      onDone(result.purchase.purchaseNumber);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Unable to record the receipt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Receive stock" onClose={onClose} className="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Receiving mode" htmlFor="receive-mode">
          <SelectInput id="receive-mode" value={mode} onChange={(e) => setMode(e.target.value as 'PO' | 'DIRECT')}>
            <option value="PO">Against a purchase order</option>
            <option value="DIRECT">Direct purchase (no order)</option>
          </SelectInput>
        </Field>

        {mode === 'PO' ? (
          <>
            <Field label="Purchase order" htmlFor="receive-order" required>
              <SelectInput id="receive-order" value={orderId} onChange={(e) => void pickOrder(e.target.value)} required>
                <option value="">Choose an open order…</option>
                {openOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} · {o.supplier.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {orderLines.length > 0 && (
              <div className="space-y-2">
                <span className="block text-sm font-medium text-slate-700">Quantities</span>
                {orderLines.map((line, index) => (
                  <div key={line.purchaseOrderItemId} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900">{line.productName}</span>
                      <span className="text-xs text-slate-500">{line.remaining} remaining</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <TextInput
                        aria-label={`Received for ${line.productName}`}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Received"
                        value={line.quantityReceived}
                        onChange={(e) => setOrderLine(index, { quantityReceived: e.target.value })}
                      />
                      <TextInput
                        aria-label={`Damaged for ${line.productName}`}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Damaged"
                        value={line.quantityDamaged}
                        onChange={(e) => setOrderLine(index, { quantityDamaged: e.target.value })}
                      />
                      <TextInput
                        aria-label={`Missing for ${line.productName}`}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Missing"
                        value={line.quantityMissing}
                        onChange={(e) => setOrderLine(index, { quantityMissing: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <Field label="Supplier" htmlFor="receive-supplier" required>
              <SelectInput
                id="receive-supplier"
                value={directSupplierId}
                onChange={(e) => setDirectSupplierId(e.target.value)}
                required
              >
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <DirectProductLines lines={directLines} setLine={setDirectLine} />
          </>
        )}

        <Field label="Invoice reference" htmlFor="receive-invoice">
          <TextInput id="receive-invoice" value={invoiceReference} onChange={(e) => setInvoiceReference(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="receive-notes">
          <TextArea id="receive-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <FormError message={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Recording…' : 'Record receipt'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DirectProductLines({
  lines,
  setLine,
}: {
  lines: { productId: string; quantityOrdered: string; quantityReceived: string; unitCost: string }[];
  setLine: (index: number, patch: Partial<{ productId: string; quantityOrdered: string; quantityReceived: string; unitCost: string }>) => void;
}) {
  const [products, setProducts] = useState<{ id: string; name: string; sku: string }[]>([]);

  useEffect(() => {
    productsApi
      .list({ status: 'ACTIVE', pageSize: 500 })
      .then((data) => setProducts(data.items.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-slate-700">Line items</span>
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[1fr_4rem_4rem_5rem] items-end gap-2">
          <SelectInput
            aria-label={`Product for line ${index + 1}`}
            value={line.productId}
            onChange={(e) => setLine(index, { productId: e.target.value })}
          >
            <option value="">Product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </SelectInput>
          <TextInput
            aria-label={`Ordered for line ${index + 1}`}
            type="number"
            min="0"
            step="1"
            placeholder="Ord."
            value={line.quantityOrdered}
            onChange={(e) => setLine(index, { quantityOrdered: e.target.value })}
          />
          <TextInput
            aria-label={`Received for line ${index + 1}`}
            type="number"
            min="0"
            step="1"
            placeholder="Recv."
            value={line.quantityReceived}
            onChange={(e) => setLine(index, { quantityReceived: e.target.value })}
          />
          <TextInput
            aria-label={`Unit cost for line ${index + 1}`}
            type="number"
            min="0"
            step="0.01"
            placeholder="Cost"
            value={line.unitCost}
            onChange={(e) => setLine(index, { unitCost: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}
