import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { formatCurrency } from '@/lib/inventoryApi';
import { purchaseReturnsApi } from '@/lib/stage8Api';
import type { PurchaseReturn, PurchaseReturnListItem, PurchaseReturnStatus } from '@/types/api';

const PAGE_SIZE = 15;

const statusLabels: Record<PurchaseReturnStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const statusClasses: Record<PurchaseReturnStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
};

function StatusPill({ status }: { status: PurchaseReturnStatus }): ReactElement {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClasses[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

export function PurchaseReturnsPage(): ReactElement {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | PurchaseReturnStatus>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PurchaseReturnListItem[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseReturn | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    purchaseReturnsApi
      .list({
        q: q || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
        sortBy: 'returnDate',
        sortOrder: 'desc',
      })
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setTotalPages(response.pagination.totalPages);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err, 'Unable to load purchase returns.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, status, page, reloadTick]);

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  const openDetail = useCallback(async (returnId: string) => {
    setDetailId(returnId);
    setDetail(null);
    setDetailLoading(true);
    setActionError(null);
    try {
      const response = await purchaseReturnsApi.get(returnId);
      setDetail(response.return);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not load the return.'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const cancel = async (returnId: string) => {
    setActionError(null);
    try {
      await purchaseReturnsApi.cancel(returnId);
      setDetail(null);
      setDetailId(null);
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not cancel the return.'));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Purchase returns</h1>
        <p className="mt-0.5 text-sm text-slate-500">Goods sent back to suppliers, with stock and settlement tracked.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setReloadTick((tick) => tick + 1);
        }}
      >
        <div>
          <label htmlFor="purchase-returns-q" className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Search receipt no.
          </label>
          <TextInput
            id="purchase-returns-q"
            value={q}
            placeholder="PURCHASE_RETURN…"
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="purchase-returns-status" className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Status
          </label>
          <SelectInput
            id="purchase-returns-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="PENDING">Pending</option>
          </SelectInput>
        </div>
      </form>

      {error && items === null ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingState label="Loading returns…" />
      ) : items === null || items.length === 0 ? (
        <EmptyState message="No purchase returns recorded yet." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Return #</th>
                  <th scope="col" className="px-4 py-3 font-medium">Purchase</th>
                  <th scope="col" className="px-4 py-3 font-medium">Supplier</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Credited</th>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="font-medium text-brand-700 hover:underline"
                        onClick={() => void openDetail(item.id)}
                      >
                        {item.returnNumber}
                      </button>
                    </td>
                    <td className="px-4 py-3">{item.purchaseNumber}</td>
                    <td className="px-4 py-3">{item.supplierName}</td>
                    <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.totalAmount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.creditedAmount)}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(item.returnDate).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {(detailId || detailLoading) && (
        <Modal title={detail ? `Return ${detail.returnNumber}` : 'Purchase return'} onClose={() => { setDetailId(null); setDetail(null); }} className="max-w-2xl">
          {detailLoading || !detail ? (
            <LoadingState label="Loading return…" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <span className="text-slate-500">Status</span>
                <span><StatusPill status={detail.status} /></span>
                <span className="text-slate-500">Supplier</span>
                <span>{detail.supplier.name}</span>
                <span className="text-slate-500">Purchase</span>
                <span>{detail.purchase.purchaseNumber}</span>
                <span className="text-slate-500">Reason</span>
                <span>{detail.reason ?? '—'}</span>
                <span className="text-slate-500">Total</span>
                <span className="tabular-nums">{formatCurrency(detail.totalAmount)}</span>
                <span className="text-slate-500">Settled via supplier credit</span>
                <span className="tabular-nums">{formatCurrency(detail.creditedAmount)}</span>
                <span className="text-slate-500">Owed by supplier</span>
                <span className="tabular-nums">{formatCurrency(detail.refundDue)}</span>
                <span className="text-slate-500">Recorded by</span>
                <span>{detail.createdBy.fullName}</span>
                <span className="text-slate-500">Date</span>
                <span>{new Date(detail.returnDate).toLocaleString()}</span>
              </div>

              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Unit cost</th>
                    <th className="py-2 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2">
                        <div className="text-slate-900">{item.name}</div>
                        <div className="font-mono text-xs text-slate-500">{item.sku}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{item.quantityReturned}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(item.unitCost)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {actionError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p> : null}

              {isAdmin && detail.status === 'COMPLETED' ? (
                <div className="flex justify-end border-t border-slate-100 pt-3">
                  <Button variant="danger" onClick={() => void cancel(detail.id)}>
                    Cancel return &amp; restock
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
