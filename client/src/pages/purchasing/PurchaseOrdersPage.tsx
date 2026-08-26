import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
import { PaginationControls } from '@/components/ui/PaginationControls';
import { ApiClientError } from '@/lib/api';
import { productsApi } from '@/lib/catalogApi';
import {
  purchaseOrderStatusClasses,
  purchaseOrderStatusLabels,
  purchaseOrdersApi,
  suppliersApi,
} from '@/lib/purchasingApi';
import type { ProductListItem, PurchaseOrder, PurchaseOrderItemInput, Supplier } from '@/types/api';

const PAGE_SIZE = 25;

interface LineDraft {
  productId: string;
  quantityOrdered: string;
  unitCost: string;
}

function formatMoney(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `TZS ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [status, setStatus] = useState<'' | Exclude<PurchaseOrder['status'], never>>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PurchaseOrder[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ productId: '', quantityOrdered: '', unitCost: '' }]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [submitTarget, setSubmitTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    purchaseOrdersApi
      .list({ status: status || undefined, page, pageSize: PAGE_SIZE, sortBy: 'createdAt', sortOrder: 'desc' })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotalPages(data.pagination.totalPages);
        setTotalItems(data.pagination.totalItems);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load purchase orders. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, page, reloadTick]);

  useEffect(() => {
    suppliersApi
      .list({ status: 'ACTIVE', pageSize: 500 })
      .then((data) => setSuppliers(data.items))
      .catch(() => undefined);
    productsApi
      .list({ status: 'ACTIVE', pageSize: 500 })
      .then((data) => setProducts(data.items))
      .catch(() => undefined);
  }, []);

  function openCreate() {
    setEditingId(null);
    setSupplierId('');
    setExpectedDelivery('');
    setNotes('');
    setLines([{ productId: '', quantityOrdered: '', unitCost: '' }]);
    setFormError(null);
    setFormOpen(true);
  }

  async function openEdit(order: PurchaseOrder) {
    setEditingId(order.id);
    setSupplierId(order.supplierId);
    setExpectedDelivery(order.expectedDelivery ? order.expectedDelivery.slice(0, 10) : '');
    setNotes(order.notes ?? '');
    setFormError(null);
    setDetail(null);
    try {
      const full = await purchaseOrdersApi.get(order.id);
      setLines(
        (full.purchaseOrder.items ?? []).map((i) => ({
          productId: i.productId,
          quantityOrdered: String(i.quantityOrdered),
          unitCost: String(Number(i.unitCost)),
        })),
      );
    } catch {
      setLines([{ productId: '', quantityOrdered: '', unitCost: '' }]);
    }
    setFormOpen(true);
  }

  async function openDetail(order: PurchaseOrder) {
    setDetailLoading(true);
    setActionError(null);
    try {
      const full = await purchaseOrdersApi.get(order.id);
      setDetail(full.purchaseOrder);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to load the order.');
    } finally {
      setDetailLoading(false);
    }
  }

  function setLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submitForm() {
    const itemInputs: PurchaseOrderItemInput[] = [];
    for (const line of lines) {
      if (!line.productId && !line.quantityOrdered && !line.unitCost) continue;
      const qty = Number(line.quantityOrdered);
      const cost = Number(line.unitCost);
      if (!line.productId || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
        setFormError('Every line needs a product, a positive quantity and a valid unit cost.');
        return;
      }
      itemInputs.push({ productId: line.productId, quantityOrdered: qty, unitCost: cost });
    }
    if (!supplierId) {
      setFormError('Choose a supplier.');
      return;
    }
    if (itemInputs.length === 0) {
      setFormError('Add at least one line item.');
      return;
    }
    setFormBusy(true);
    setFormError(null);
    const payload = {
      supplierId,
      expectedDelivery: expectedDelivery || null,
      notes: notes.trim() || null,
      items: itemInputs,
    };
    try {
      if (editingId) {
        await purchaseOrdersApi.update(editingId, payload);
        setSuccess('Purchase order updated.');
      } else {
        await purchaseOrdersApi.create(payload);
        setSuccess('Purchase order created as a draft.');
      }
      setFormOpen(false);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Unable to save the purchase order.');
    } finally {
      setFormBusy(false);
    }
  }

  async function submitOrder() {
    if (!submitTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await purchaseOrdersApi.submit(submitTarget.id);
      setSuccess(`Order ${submitTarget.orderNumber} submitted to the supplier.`);
      setSubmitTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to submit the order.');
    } finally {
      setActionBusy(false);
    }
  }

  async function cancelOrder() {
    if (!cancelTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await purchaseOrdersApi.cancel(cancelTarget.id);
      setSuccess(`Order ${cancelTarget.orderNumber} cancelled.`);
      setCancelTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to cancel the order.');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Purchase orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Draft, submit and track orders to your suppliers.
          </p>
        </div>
        <Button onClick={openCreate}>New purchase order</Button>
      </div>

      <nav className="flex gap-4 text-sm text-slate-500">
        <span className="font-medium text-brand-600">Orders</span>
        <Link to="/purchasing/purchases" className="hover:text-brand-600">
          Receiving
        </Link>
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
        <Field label="Status" htmlFor="po-status">
          <SelectInput
            id="po-status"
            value={status}
            className="max-w-xs"
            onChange={(e) => {
              setStatus(e.target.value as '' | PurchaseOrder['status']);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING">Submitted</option>
            <option value="PARTIALLY_RECEIVED">Partially received</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </SelectInput>
        </Field>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading purchase orders…" />
      ) : !items || items.length === 0 ? (
        <EmptyState message="No purchase orders match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
            {totalItems} order{totalItems === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Order date</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">{o.orderNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{o.supplier.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${purchaseOrderStatusClasses[o.status]}`}
                      >
                        {purchaseOrderStatusLabels[o.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatMoney(o.totalAmount)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(o.orderDate)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => void openDetail(o)}>
                          View
                        </Button>
                        {isAdmin && o.status === 'DRAFT' && (
                          <>
                            <Button variant="ghost" onClick={() => void openEdit(o)}>
                              Edit
                            </Button>
                            <Button variant="ghost" onClick={() => setSubmitTarget(o)}>
                              Submit
                            </Button>
                          </>
                        )}
                        {isAdmin && (o.status === 'DRAFT' || o.status === 'PENDING') && (
                          <Button variant="ghost" onClick={() => setCancelTarget(o)}>
                            Cancel
                          </Button>
                        )}
                      </div>
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

      {formOpen && (
        <Modal
          title={editingId ? 'Edit draft purchase order' : 'New purchase order'}
          onClose={() => setFormOpen(false)}
          className="max-w-2xl"
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitForm();
            }}
          >
            <Field label="Supplier" htmlFor="po-supplier" required>
              <SelectInput id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Expected delivery" htmlFor="po-delivery">
              <TextInput
                id="po-delivery"
                type="date"
                value={expectedDelivery}
                onChange={(e) => setExpectedDelivery(e.target.value)}
              />
            </Field>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-slate-700">Line items</span>
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_5rem_6rem_auto] items-end gap-2">
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
                    aria-label={`Quantity for line ${index + 1}`}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Qty"
                    value={line.quantityOrdered}
                    onChange={(e) => setLine(index, { quantityOrdered: e.target.value })}
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
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    disabled={lines.length === 1}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines((prev) => [...prev, { productId: '', quantityOrdered: '', unitCost: '' }])}
              >
                Add line
              </Button>
            </div>

            <Field label="Notes" htmlFor="po-notes">
              <TextArea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            <FormError message={formError} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={formBusy}>
                {formBusy ? 'Saving…' : editingId ? 'Save changes' : 'Create draft'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {(detail || detailLoading) && (
        <Modal title={detail ? `Order ${detail.orderNumber}` : 'Purchase order'} onClose={() => setDetail(null)} className="max-w-2xl">
          {detailLoading || !detail ? (
            <LoadingState label="Loading order…" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <span className="text-slate-500">Supplier</span>
                <span className="text-slate-900">{detail.supplier.name}</span>
                <span className="text-slate-500">Status</span>
                <span>{purchaseOrderStatusLabels[detail.status]}</span>
                <span className="text-slate-500">Order date</span>
                <span>{formatDate(detail.orderDate)}</span>
                <span className="text-slate-500">Expected delivery</span>
                <span>{formatDate(detail.expectedDelivery)}</span>
                <span className="text-slate-500">Total</span>
                <span className="tabular-nums">{formatMoney(detail.totalAmount)}</span>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 text-right font-medium">Ordered</th>
                    <th className="py-2 text-right font-medium">Received</th>
                    <th className="py-2 text-right font-medium">Remaining</th>
                    <th className="py-2 text-right font-medium">Unit cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(detail.items ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className="py-2">
                        <div className="text-slate-900">{i.product.name}</div>
                        <div className="font-mono text-xs text-slate-500">{i.product.sku}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{i.quantityOrdered}</td>
                      <td className="py-2 text-right tabular-nums">{i.received}</td>
                      <td className="py-2 text-right tabular-nums">{i.remaining}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(i.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.notes && <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">{detail.notes}</p>}
            </div>
          )}
        </Modal>
      )}

      {submitTarget && (
        <ConfirmDialog
          title="Submit purchase order"
          message={`Submit ${submitTarget.orderNumber} to ${submitTarget.supplier.name}? The order becomes immutable and ready for receiving.`}
          confirmLabel="Submit order"
          busyLabel="Submitting…"
          busy={actionBusy}
          onConfirm={() => void submitOrder()}
          onCancel={() => setSubmitTarget(null)}
        />
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel purchase order"
          message={`Cancel ${cancelTarget.orderNumber}? This cannot be undone.`}
          confirmLabel="Cancel order"
          busyLabel="Cancelling…"
          busy={actionBusy}
          onConfirm={() => void cancelOrder()}
          onCancel={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
