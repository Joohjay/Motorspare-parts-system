import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState, SelectInput, errorMessage } from '@/components/ui/FormControls';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { ApiClientError } from '@/lib/api';
import { formatQuantity, inventoryApi, reservationStatusLabels } from '@/lib/inventoryApi';
import type { ReservationStatus, StockReservation } from '@/types/api';

const PAGE_SIZE = 25;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function ReservationsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [status, setStatus] = useState<'' | ReservationStatus>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<StockReservation[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [releaseTarget, setReleaseTarget] = useState<StockReservation | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    inventoryApi
      .reservations({
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
        sortBy: 'createdAt',
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
        setError(errorMessage(err, 'Unable to load reservations. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, page, reloadTick]);

  async function release() {
    if (!releaseTarget) return;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      await inventoryApi.release(releaseTarget.id);
      setReleaseTarget(null);
      setSuccess(`Reservation of ${formatQuantity(releaseTarget.quantity)} units released.`);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setReleaseError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to release reservation. Please try again.',
      );
    } finally {
      setReleaseBusy(false);
    }
  }

  const statusClasses: Record<ReservationStatus, string> = {
    ACTIVE: 'bg-amber-50 text-amber-700 ring-amber-200',
    FULFILLED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
    EXPIRED: 'bg-slate-100 text-slate-600 ring-slate-200',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reservations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock reserved for orders and commitments.
          </p>
        </div>
        <Link to="/inventory" className="text-sm text-slate-500 hover:text-brand-600">
          ← Back to inventory
        </Link>
      </div>

      {success && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}

      <Card className="p-4">
        <label htmlFor="reservation-status" className="block text-sm font-medium text-slate-700">
          Status
        </label>
        <SelectInput
          id="reservation-status"
          value={status}
          className="max-w-xs"
          onChange={(e) => {
            setStatus(e.target.value as '' | ReservationStatus);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="FULFILLED">Fulfilled</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="EXPIRED">Expired</option>
        </SelectInput>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading reservations…" />
      ) : !items || items.length === 0 ? (
        <EmptyState message="No reservations match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
            {totalItems} reservation{totalItems === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 text-right font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Reserved until</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/inventory/${r.productId}`}
                        className="font-medium text-slate-900 hover:text-brand-600"
                      >
                        {r.product.name}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">{r.product.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                      {formatQuantity(r.quantity)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClasses[r.status]}`}
                      >
                        {reservationStatusLabels[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.reservedUntil)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.createdBy ? r.createdBy.fullName : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && r.status === 'ACTIVE' ? (
                        <Button variant="ghost" onClick={() => setReleaseTarget(r)}>
                          Release
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {r.status === 'ACTIVE' ? '—' : 'Read only'}
                        </span>
                      )}
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

      {releaseTarget && (
        <ConfirmDialog
          title="Release reservation"
          message={`Release the reservation of ${formatQuantity(releaseTarget.quantity)} units for ${releaseTarget.product.name}? The stock will become available again.`}
          confirmLabel="Release reservation"
          busyLabel="Releasing…"
          busy={releaseBusy}
          onConfirm={() => void release()}
          onCancel={() => setReleaseTarget(null)}
        />
      )}

      {releaseError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {releaseError}
        </p>
      )}
    </div>
  );
}