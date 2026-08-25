import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  errorMessage,
} from '@/components/ui/FormControls';
import { dashboardApi } from '@/lib/stage8Api';
import type { Dashboard as DashboardData } from '@/types/api';

function StatCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }): ReactElement {
  return (
    <div className={`rounded-lg border p-4 ${accent ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function SectionCard({ title, action, children }: { title: string; action?: ReactElement; children: React.ReactNode }): ReactElement {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DashboardPage(): ReactElement {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await dashboardApi.get();
      setDashboard(response.dashboard);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the dashboard'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <ErrorState message={error} />;
  }
  if (!dashboard) {
    return <LoadingState label="Loading dashboard…" />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-slate-950 p-6 text-white">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, {user?.name ?? 'user'}</h1>
        <p className="mt-1 text-sm text-slate-300">Here is how the shop is doing today.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/pos"><Button variant="secondary" className="!bg-white !text-slate-900 hover:!bg-slate-200">New sale</Button></Link>
          {isAdmin ? (
            <>
              <Link to="/purchasing/purchase-orders"><Button variant="secondary" className="!border-slate-600 !text-slate-200 hover:!bg-slate-800">Purchase orders</Button></Link>
              <Link to="/expenses"><Button variant="secondary" className="!border-slate-600 !text-slate-200 hover:!bg-slate-800">Record expense</Button></Link>
            </>
          ) : null}
          <Link to="/inventory/reservations"><Button variant="secondary" className="!border-slate-600 !text-slate-200 hover:!bg-slate-800">Reservations</Button></Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sales today" value={`${dashboard.todaySales.saleCount}`} sub={`Revenue ${formatMoney(dashboard.todaySales.revenue)}`} accent />
        <StatCard label="Average sale today" value={formatMoney(dashboard.todaySales.averageSaleValue)} />
        <StatCard
          label="Low / out of stock"
          value={`${dashboard.inventoryAlerts.lowStockCount} / ${dashboard.inventoryAlerts.outOfStockCount}`}
          sub="products need attention"
        />
        <StatCard
          label="Customer credit outstanding"
          value={formatMoney(dashboard.creditSummary.totalOutstanding)}
          sub={`${dashboard.creditSummary.activeAccounts} active accounts`}
        />
        {isAdmin && dashboard.todayFinancials ? (
          <StatCard
            label="Gross profit today"
            value={formatMoney(dashboard.todayFinancials.grossProfit)}
            sub={`COGS ${formatMoney(dashboard.todayFinancials.cogs)}`}
            accent
          />
        ) : null}
        {isAdmin && dashboard.todayFinancials ? (
          <StatCard
            label="Expenses today"
            value={formatMoney(dashboard.todayFinancials.expensesTotal)}
            sub={`Net ${formatMoney(dashboard.todayFinancials.netProfit)}`}
          />
        ) : null}
        <StatCard label="Supplier credit outstanding" value={formatMoney(dashboard.supplierCredit.totalOutstanding)} sub={`${dashboard.supplierCredit.activeAccounts} active accounts`} />
        <StatCard label="Open purchase orders" value={`${dashboard.pendingPurchaseOrders}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Payments received today">
          {dashboard.paymentBreakdownToday.length === 0 ? (
            <EmptyState message="No payments recorded yet today." />
          ) : (
            <ul className="space-y-2 text-sm">
              {dashboard.paymentBreakdownToday.map((entry) => (
                <li key={entry.paymentMethod} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="font-medium text-slate-700">{entry.paymentMethod.replace('_', ' ')}</span>
                  <span className="tabular-nums">{formatMoney(entry.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Low stock alerts">
          {dashboard.inventoryAlerts.lowStockItems.length === 0 ? (
            <EmptyState message="Nothing is running low. Good job." />
          ) : (
            <ul className="space-y-2 text-sm">
              {dashboard.inventoryAlerts.lowStockItems.map((item) => (
                <li key={item.productId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-slate-400">{item.sku}</span>{' '}
                    <Link to={`/inventory/${item.productId}`} className="font-medium text-brand-700 hover:underline">{item.name}</Link>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">
                    {item.quantity} / min {item.minimumStock}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Top sellers this month">
          {dashboard.topProductsThisMonth.length === 0 ? (
            <EmptyState message="No sales recorded yet this month." />
          ) : (
            <ul className="space-y-2 text-sm">
              {dashboard.topProductsThisMonth.map((product) => (
                <li key={product.productId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-slate-400">{product.sku}</span>{' '}
                    <span className="font-medium text-slate-700">{product.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">{product.unitsSold} sold</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent sales" action={<Link to="/sales" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
          {dashboard.recentSales.length === 0 ? (
            <EmptyState message="No sales yet." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th scope="col" className="pb-2">Receipt</th>
                  <th scope="col" className="pb-2">Cashier</th>
                  <th scope="col" className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboard.recentSales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="py-2">
                      <Link to={`/sales/${sale.id}`} className="font-medium text-brand-700 hover:underline">{sale.saleNumber}</Link>
                      {sale.status !== 'COMPLETED' ? <span className="ml-2 text-xs text-red-600">voided</span> : null}
                    </td>
                    <td className="py-2 text-slate-600">{sale.cashierName}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(sale.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Recent purchases" action={<Link to="/purchasing/purchases" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
          {dashboard.recentPurchases.length === 0 ? (
            <EmptyState message="No purchases yet." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th scope="col" className="pb-2">Purchase</th>
                  <th scope="col" className="pb-2">Supplier</th>
                  <th scope="col" className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboard.recentPurchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="py-2 font-medium text-slate-700">{purchase.purchaseNumber}</td>
                    <td className="py-2 text-slate-600">{purchase.supplierName}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(purchase.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Top customer debtors"
        action={<Link to="/customers" className="text-sm font-medium text-brand-700 hover:underline">Customers</Link>}
      >
        {dashboard.creditSummary.topDebtors.length === 0 ? (
          <EmptyState message="No outstanding customer credit." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th scope="col" className="pb-2">Customer</th>
                <th scope="col" className="pb-2">Phone</th>
                <th scope="col" className="pb-2 text-right">Outstanding</th>
                <th scope="col" className="pb-2 text-right">Limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard.creditSummary.topDebtors.map((debtor) => (
                <tr key={debtor.customerId}>
                  <td className="py-2">
                    <Link to={`/customers/${debtor.customerId}`} className="font-medium text-brand-700 hover:underline">{debtor.name}</Link>
                  </td>
                  <td className="py-2 text-slate-600">{debtor.phone ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(debtor.outstandingBalance)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-500">{formatMoney(debtor.creditLimit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <p className="text-xs text-slate-400">Generated at {new Date(dashboard.generatedAt).toLocaleString()}</p>
    </div>
  );
}
