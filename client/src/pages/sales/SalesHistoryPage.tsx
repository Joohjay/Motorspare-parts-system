import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  EmptyState,
  FormError,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { saleStatusClasses, saleStatusLabels, saleTypeLabels, salesApi } from '@/lib/salesApi';
import { formatCurrency } from '@/lib/inventoryApi';
import type { SaleListItem } from '@/types/api';

export function SalesHistoryPage(): ReactElement {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sales, setSales] = useState<SaleListItem[] | null>(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setError(null);
      try {
        const result = await salesApi.list({
          q: query || undefined,
          status: (statusFilter || undefined) as 'COMPLETED' | 'VOID' | undefined,
          page,
          pageSize: 10,
        });
        setSales(result.items);
        setPagination({ page: result.pagination.page, totalPages: result.pagination.totalPages });
      } catch (err) {
        setError(errorMessage(err, 'Could not load sales'));
      }
    },
    [query, statusFilter],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sales</h1>
        <p className="text-sm text-slate-500">Every sale recorded at the counter.</p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1);
        }}
      >
        <TextInput
          placeholder="Search by sale number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <SelectInput
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="max-w-[10rem]"
        >
          <option value="">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="VOID">Voided</option>
        </SelectInput>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Filter
        </button>
      </form>

      <FormError message={error} />

      {sales === null ? (
        <LoadingState />
      ) : sales.length === 0 ? (
        <EmptyState message="No sales found." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Sale</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link to={`/sales/${sale.id}`} className="font-medium text-brand-700 hover:underline">
                      {sale.saleNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{sale.customerName ?? 'Walk-in'}</td>
                  <td className="px-4 py-3">{saleTypeLabels[sale.saleType]}</td>
                  <td className="px-4 py-3">{sale.itemCount}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatCurrency(sale.totalAmount)}
                  </td>
                  <td className="px-4 py-3">{new Date(sale.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${saleStatusClasses[sale.status]}`}
                    >
                      {saleStatusLabels[sale.status]}
                    </span>
                  </td>
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
