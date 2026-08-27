import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, FormError, SelectInput, TextArea, TextInput, errorMessage } from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { Spinner } from '@/components/ui/Spinner';
import { StockStatusPill } from '@/components/ui/StockStatusPill';
import { ApiClientError } from '@/lib/api';
import { productsApi } from '@/lib/catalogApi';
import {
  formatCurrency,
  formatQuantity,
  inventoryApi,
  transactionTypeLabels,
} from '@/lib/inventoryApi';
import type {
  InventoryDetail,
  InventoryTransaction,
  ProductDetail,
} from '@/types/api';

const PAGE_SIZE = 25;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatSigned(value: number): string {
  const formatted = formatQuantity(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : '0';
}

type MovementFilter = '' | 'in' | 'out';

export function InventoryDetailPage() {
  const { productId = '' } = useParams<{ productId: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [inventory, setInventory] = useState<InventoryDetail | null>(null);
  const [invLoading, setInvLoading] = useState(true);
  const [invError, setInvError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);

  const [transactions, setTransactions] = useState<InventoryTransaction[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [txnPage, setTxnPage] = useState(1);
  const [txnType, setTxnType] = useState('');
  const [movement, setMovement] = useState<MovementFilter>('');
  const [txnError, setTxnError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustType, setAdjustType] = useState<'ADJUSTMENT' | 'DAMAGE' | 'LOSS'>('ADJUSTMENT');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSuccess, setAdjustSuccess] = useState<string | null>(null);

  const loadInventory = useCallback(() => {
    let active = true;
    setInvLoading(true);
    setInvError(null);
    inventoryApi
      .get(productId)
      .then((data) => {
        if (!active) return;
        setInventory(data.inventory);
        setInvLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setInvError(errorMessage(err, 'Unable to load inventory. Please try again.'));
        setInvLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  useEffect(() => loadInventory(), [loadInventory, reloadTick]);

  useEffect(() => {
    let active = true;
    productsApi
      .get(productId)
      .then((data) => {
        if (!active) return;
        setProduct(data.product);
      })
      .catch(() => {
        // Product metadata (minimum stock, reorder level) is supplemental.
      });
    return () => {
      active = false;
    };
  }, [productId]);

  useEffect(() => {
    let active = true;
    setTxnError(null);
    inventoryApi
      .transactions(productId, {
        type: txnType || undefined,
        movement: movement || undefined,
        page: txnPage,
        pageSize: PAGE_SIZE,
      })
      .then((data) => {
        if (!active) return;
        setTransactions(data.items);
        setTotalPages(data.pagination.totalPages);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setTxnError(errorMessage(err, 'Unable to load transaction history.'));
      });
    return () => {
      active = false;
    };
  }, [productId, txnType, movement, txnPage, reloadTick]);

  function refreshAll() {
    setTxnPage(1);
    setReloadTick((t) => t + 1);
  }

  const adjustQtyNum = Number(adjustQty);
  const adjustedNewStock = inventory ? inventory.quantityOnHand + (Number.isFinite(adjustQtyNum) ? adjustQtyNum : 0) : 0;
  const adjustValid =
    Number.isInteger(adjustQtyNum) &&
    adjustQtyNum !== 0 &&
    adjustReason.trim().length > 0 &&
    (adjustQtyNum > 0 ? adjustType === 'ADJUSTMENT' : true) &&
    adjustedNewStock >= 0;

  async function submitAdjust() {
    if (!inventory || !adjustValid) return;
    setAdjustBusy(true);
    setAdjustError(null);
    setAdjustSuccess(null);
    try {
      await inventoryApi.adjust(inventory.productId, {
        quantity: adjustQtyNum,
        reason: adjustReason.trim(),
        type: adjustQtyNum > 0 ? 'ADJUSTMENT' : adjustType,
      });
      setAdjustOpen(false);
      setAdjustQty('');
      setAdjustReason('');
      setAdjustType('ADJUSTMENT');
      setAdjustSuccess('Stock adjustment saved. Inventory and history have been refreshed.');
      refreshAll();
    } catch (err) {
      setAdjustError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to save adjustment. Please try again.',
      );
    } finally {
      setAdjustBusy(false);
    }
  }

  const statRow = (label: string, value: string, emphasize = false) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`text-sm tabular-nums ${emphasize ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
        {value}
      </dd>
    </div>
  );

  const movementLabel = useMemo(() => {
    if (!movement) return '';
    return movement === 'in' ? 'Stock in only' : 'Stock out only';
  }, [movement]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/inventory" className="text-sm text-slate-500 hover:text-brand-600">
            ← Back to inventory
          </Link>
          {invLoading ? (
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Loading…</h1>
          ) : (
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {inventory?.name ?? 'Product'}
            </h1>
          )}
          {inventory && (
            <p className="mt-1 text-sm text-slate-500">
              <span className="font-mono text-xs">{inventory.sku}</span>
              {inventory.brandName ? ` · ${inventory.brandName}` : ''}
            </p>
          )}
        </div>
        {isAdmin && inventory && (
          <div className="flex gap-2">
            <Button onClick={() => setAdjustOpen(true)}>Adjust stock</Button>
          </div>
        )}
      </div>

      {adjustSuccess && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {adjustSuccess}
        </p>
      )}

      {invError ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {invError}
        </div>
      ) : !inventory ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
            <Card className="p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Stock
              </h2>
              <dl className="mt-4">
                {statRow('On hand', formatQuantity(inventory.quantityOnHand), true)}
                {statRow('Available', formatQuantity(inventory.available), true)}
                {statRow('Weighted avg. cost', formatCurrency(inventory.weightedAverageCost))}
                {statRow('Inventory value', formatCurrency(inventory.inventoryValue), true)}
                {statRow('Minimum stock', formatQuantity(product?.minimumStock ?? 0))}
                {statRow('Reorder level', formatQuantity(product?.reorderLevel ?? 0))}
              </dl>
              {product?.description && (
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{product.description}</p>
              )}
              <div className="mt-4">
                <span className="text-sm text-slate-500">Status </span>
                <StockStatusPill status={inventory.status} />
              </div>
            </Card>
          </div>

          <Card className="p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Transaction history
              </h2>
              <div className="flex flex-wrap gap-2">
                <div>
                  <label htmlFor="txn-type" className="sr-only">
                    Filter by type
                  </label>
                  <SelectInput
                    id="txn-type"
                    value={txnType}
                    className="!mt-0"
                    onChange={(e) => {
                      setTxnType(e.target.value);
                      setTxnPage(1);
                    }}
                  >
                    <option value="">All types</option>
                    {Object.entries(transactionTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <label htmlFor="txn-movement" className="sr-only">
                    Filter by movement
                  </label>
                  <SelectInput
                    id="txn-movement"
                    value={movement}
                    className="!mt-0"
                    onChange={(e) => {
                      setMovement(e.target.value as MovementFilter);
                      setTxnPage(1);
                    }}
                  >
                    <option value="">All movements</option>
                    <option value="in">Stock in</option>
                    <option value="out">Stock out</option>
                  </SelectInput>
                </div>
              </div>
            </div>

            {movementLabel && (
              <p className="mt-2 text-xs text-slate-500">Showing: {movementLabel}</p>
            )}

            {txnError ? (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {txnError}
              </p>
            ) : !transactions ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : transactions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No transactions recorded for this product yet.
              </p>
            ) : (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date/time</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                        <th className="px-3 py-2 text-right font-medium">Balance</th>
                        <th className="px-3 py-2 font-medium">Reason / reference</th>
                        <th className="px-3 py-2 font-medium">User</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {formatDateTime(t.createdAt)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                t.quantity > 0
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                  : t.quantity < 0
                                    ? 'bg-red-50 text-red-700 ring-red-200'
                                    : 'bg-slate-100 text-slate-600 ring-slate-200'
                              }`}
                            >
                              {transactionTypeLabels[t.type] ?? t.type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                            {formatSigned(t.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                            {t.unitCost !== null ? formatCurrency(t.unitCost) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {formatQuantity(t.balanceAfter)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {t.note || (t.referenceId ? `Reference ${t.referenceId}` : '—')}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {t.createdBy ? t.createdBy.fullName : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <PaginationControls page={txnPage} totalPages={totalPages} onPageChange={setTxnPage} />
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {adjustOpen && inventory && (
        <Modal title="Adjust stock" onClose={() => setAdjustOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdjust();
            }}
          >
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Summary</p>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Current stock</dt>
                    <dd className="font-medium text-slate-900">{formatQuantity(inventory.quantityOnHand)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Adjustment</dt>
                    <dd className={`font-medium ${adjustQtyNum < 0 ? 'text-red-600' : adjustQtyNum > 0 ? 'text-emerald-700' : ''}`}>
                      {adjustQty === '' ? '—' : formatSigned(adjustQtyNum)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">New stock</dt>
                    <dd className="font-semibold text-slate-900">{formatQuantity(adjustedNewStock)}</dd>
                  </div>
                </dl>
              </div>

              <Field label="Quantity" htmlFor="adjust-qty" required hint="Negative to reduce stock, positive to add.">
                <TextInput
                  id="adjust-qty"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  autoFocus
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  aria-describedby={adjustQtyNum < 0 && adjustedNewStock < 0 ? 'adjust-newstock-error' : undefined}
                  aria-invalid={adjustQty !== '' && !Number.isInteger(adjustQtyNum)}
                />
                {adjustQtyNum < 0 && adjustedNewStock < 0 && (
                  <p id="adjust-newstock-error" className="mt-1 text-xs text-red-600" role="alert">
                    This would drive stock below zero.
                  </p>
                )}
              </Field>

              <Field label="Reason" htmlFor="adjust-reason" required>
                <TextArea
                  id="adjust-reason"
                  rows={2}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. damaged unit, stocktake correction"
                />
              </Field>

              <Field label="Adjustment type" htmlFor="adjust-type" hint={adjustQtyNum > 0 ? 'Positive adjustments are recorded as ADJUSTMENT.' : undefined}>
                <SelectInput
                  id="adjust-type"
                  value={adjustType}
                  disabled={adjustQtyNum > 0}
                  onChange={(e) => setAdjustType(e.target.value as 'ADJUSTMENT' | 'DAMAGE' | 'LOSS')}
                >
                  <option value="ADJUSTMENT">Adjustment</option>
                  <option value="DAMAGE">Damage</option>
                  <option value="LOSS">Loss</option>
                </SelectInput>
              </Field>

              <FormError message={adjustError} />

              <div className="flex justify-end gap-3">
                <Button variant="secondary" type="button" disabled={adjustBusy} onClick={() => setAdjustOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!adjustValid || adjustBusy}>
                  {adjustBusy ? (
                    <>
                      <Spinner /> Saving…
                    </>
                  ) : (
                    'Save adjustment'
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}