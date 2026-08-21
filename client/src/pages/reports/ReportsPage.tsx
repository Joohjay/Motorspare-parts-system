import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  EmptyState,
  Field,
  FormError,
  LoadingState,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { reportsApi } from '@/lib/financeApi';
import { formatCurrency } from '@/lib/inventoryApi';
import type { CreditSummaryReport, FinancialReport } from '@/types/api';

type Preset = 'today' | 'yesterday' | 'this_week' | 'this_month' | '';

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
];

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }): ReactElement {
  return (
    <div className={`rounded-lg border p-4 ${accent ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function ReportsPage(): ReactElement {
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [financial, setFinancial] = useState<FinancialReport | null>(null);
  const [credit, setCredit] = useState<CreditSummaryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query =
        preset !== ''
          ? { preset }
          : { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      const [financialReport, creditReport] = await Promise.all([
        reportsApi.financial(query),
        reportsApi.credit(),
      ]);
      setFinancial(financialReport);
      setCredit(creditReport);
    } catch (err) {
      setError(errorMessage(err, 'Could not load reports'));
    }
  }, [preset, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">Sales performance, profitability and credit exposure.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <Field label="Range" htmlFor="report-preset">
          <select
            id="report-preset"
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="">Custom…</option>
          </select>
        </Field>
        {preset === '' && (
          <>
            <Field label="From" htmlFor="report-from">
              <TextInput id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="report-to">
              <TextInput id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Apply
        </button>
      </form>

      <FormError message={error} />

      {!financial ? (
        <LoadingState />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Sales" value={String(financial.sales.saleCount)} />
            <StatCard label="Revenue" value={formatCurrency(financial.sales.revenue)} />
            <StatCard label="COGS" value={formatCurrency(financial.sales.cogs)} />
            <StatCard label="Gross profit" value={formatCurrency(financial.sales.grossProfit)} />
            <StatCard
              label="Net operating result"
              value={formatCurrency(financial.netOperatingResult.netOperatingResult)}
              accent
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">Payments received</h2>
              {financial.payments.length === 0 ? (
                <EmptyState message="No payments in this range." />
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {financial.payments.map((row) => (
                    <li key={row.paymentMethod} className="flex justify-between">
                      <span>{row.paymentMethod}</span>
                      <span className="font-medium text-slate-900">{formatCurrency(row.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">Expenses & returns</h2>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                <li className="flex justify-between">
                  <span>Operating expenses</span>
                  <span className="font-medium text-slate-900">{formatCurrency(financial.expenses.total)}</span>
                </li>
                <li className="flex justify-between">
                  <span>Returns refunded</span>
                  <span className="font-medium text-slate-900">{formatCurrency(financial.returns.refundedTotal)}</span>
                </li>
                <li className="flex justify-between">
                  <span>Discounts given</span>
                  <span className="font-medium text-slate-900">{formatCurrency(financial.sales.discounts)}</span>
                </li>
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
              <h2 className="text-base font-semibold text-slate-900">Customer credit exposure</h2>
              {!credit || credit.topDebtors.length === 0 ? (
                <EmptyState message="No outstanding customer credit." />
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-500">
                    {credit.activeAccounts} active account(s) ·{' '}
                    {formatCurrency(credit.totalOutstanding)} outstanding of{' '}
                    {formatCurrency(credit.totalCreditLimit)} limit.
                  </p>
                  <table className="mt-3 w-full text-sm">
                    <thead className="text-left text-xs uppercase text-slate-400">
                      <tr>
                        <th className="py-1">Customer</th>
                        <th className="py-1">Phone</th>
                        <th className="py-1 text-right">Outstanding</th>
                        <th className="py-1 text-right">Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {credit.topDebtors.map((debtor) => (
                        <tr key={debtor.customerId} className="border-t border-slate-100">
                          <td className="py-1.5 font-medium text-slate-800">{debtor.name}</td>
                          <td className="py-1.5">{debtor.phone ?? '—'}</td>
                          <td className="py-1.5 text-right">{formatCurrency(debtor.outstandingBalance)}</td>
                          <td className="py-1.5 text-right">{formatCurrency(debtor.creditLimit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
