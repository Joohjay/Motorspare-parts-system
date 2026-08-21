import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  EmptyState,
  FormError,
  LoadingState,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { formatCurrency } from '@/lib/inventoryApi';
import { salesReturnsApi } from '@/lib/salesApi';
import type { SaleReturnListItem } from '@/types/api';

export function SalesReturnsPage(): ReactElement {
  const [query, setQuery] = useState('');
  const [returns, setReturns] = useState<SaleReturnListItem[] | null>(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setError(null);
      try {
        const result = await salesReturnsApi.list({ q: query || undefined, page, pageSize: 10 });
        setReturns(result.items);
        setPagination({ page: result.pagination.page, totalPages: result.pagination.totalPages });
      } catch (err) {
        setError(errorMessage(err, 'Could not load returns'));
      }
    },
    [query],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sales returns</h1>
        <p className="text-sm text-slate-500">Goods returned by customers and refunds issued.</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1);
        }}
      >
        <TextInput
          placeholder="Search by return number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Filter
        </button>
      </form>

      <FormError message={error} />

      {returns === null ? (
        <LoadingState />
      ) : returns.length === 0 ? (
        <EmptyState message="No returns recorded." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Return</th>
                <th className="px-4 py-3">Sale</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Settlement</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((ret) => (
                <tr key={ret.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{ret.returnNumber}</td>
                  <td className="px-4 py-3">{ret.saleNumber}</td>
                  <td className="px-4 py-3">{ret.customerName ?? 'Walk-in'}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatCurrency(ret.totalAmount)}
                  </td>
                  <td className="px-4 py-3">
                    {ret.creditAdjusted ? 'Credit adjustment' : ret.refundMethod ?? '—'}
                  </td>
                  <td className="px-4 py-3">{new Date(ret.returnDate).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationControls
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(page) => void load(page)}
      />
    </div>
  );
}
