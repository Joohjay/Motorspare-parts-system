import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return 'TZS 0.00';
  return `TZS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value, sub, accent = false, icon }: { label: string; value: string; sub?: string; accent?: boolean; icon?: ReactNode }): ReactElement {
  return (
    <div className={`rounded-xl border p-4 transition-shadow hover:shadow-sm ${accent ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1.5 text-xl font-bold tabular-nums text-slate-900 leading-tight">{value}</p>
          {sub ? <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{sub}</p> : null}
        </div>
        {icon ? <span className="shrink-0 text-slate-300">{icon}</span> : null}
      </div>
    </div>
  );
}

function SectionCard({ title, action, children }: { title: string; action?: ReactElement; children: React.ReactNode }): ReactElement {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function IconSales() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>);
}
function IconAvg() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>);
}
function IconAlert() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>);
}
function IconOweYou() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>);
}
function IconProfit() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" /></svg>);
}
function IconExpenses() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>);
}
function IconYouOwe() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>);
}
function IconOrders() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>);
}

export function DashboardPage(): ReactElement {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'ADMIN';
  const greet = useMemo(greeting, []);

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

  if (error) return <ErrorState message={error} />;
  if (!dashboard) return <LoadingState label="Loading dashboard\u2026" />;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-slate-950 p-6 text-white">
        <h1 className="text-2xl font-bold tracking-tight">{greet}, {user?.name ?? 'user'}</h1>
        <p className="mt-1 text-sm text-slate-300">Here is how your shop is doing today.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/pos"><Button variant="secondary" className="!bg-white !text-slate-900 hover:!bg-slate-200">New sale</Button></Link>
          {isAdmin && (
            <>
              <Link to="/purchasing/purchase-orders"><Button variant="secondary" className="!border-slate-600 !text-slate-200 hover:!bg-slate-800">Purchase orders</Button></Link>
              <Link to="/expenses"><Button variant="secondary" className="!border-slate-600 !text-slate-200 hover:!bg-slate-800">Record expense</Button></Link>
            </>
          )}
          <Link to="/inventory/reservations"><Button variant="secondary" className="!border-slate-600 !text-slate-200 hover:!bg-slate-800">Reservations</Button></Link>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today's sales"
          value={`${dashboard.todaySales.saleCount} sale${dashboard.todaySales.saleCount === 1 ? '' : 's'}`}
          sub={`Revenue ${formatMoney(dashboard.todaySales.revenue)}`}
          accent
          icon={<IconSales />}
        />
        <StatCard label="Avg. sale value" value={formatMoney(dashboard.todaySales.averageSaleValue)} icon={<IconAvg />} />
        <div className={`rounded-xl border p-4 transition-shadow hover:shadow-sm ${dashboard.inventoryAlerts.outOfStockCount > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Stock alerts</p>
                {dashboard.inventoryAlerts.outOfStockCount > 0 && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums text-slate-900 leading-tight">
                {dashboard.inventoryAlerts.lowStockCount} low {'\u00B7'} {dashboard.inventoryAlerts.outOfStockCount} out
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">products need attention</p>
            </div>
            <span className="shrink-0 text-red-300"><IconAlert /></span>
          </div>
        </div>
        <StatCard
          label="Customers owe you"
          value={formatMoney(dashboard.creditSummary.totalOutstanding)}
          sub={`${dashboard.creditSummary.activeAccounts} active credit account${dashboard.creditSummary.activeAccounts === 1 ? '' : 's'}`}
          icon={<IconOweYou />}
        />
      </div>

      {isAdmin && dashboard.todayFinancials ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Today's profit"
            value={formatMoney(dashboard.todayFinancials.grossProfit)}
            sub={`Product cost ${formatMoney(dashboard.todayFinancials.cogs)}`}
            accent
            icon={<IconProfit />}
          />
          <StatCard
            label="Today's expenses"
            value={formatMoney(dashboard.todayFinancials.expensesTotal)}
            sub={`Net ${formatMoney(dashboard.todayFinancials.netProfit)}`}
            icon={<IconExpenses />}
          />
          <StatCard
            label="You owe suppliers"
            value={formatMoney(dashboard.supplierCredit.totalOutstanding)}
            sub={`${dashboard.supplierCredit.activeAccounts} active credit account${dashboard.supplierCredit.activeAccounts === 1 ? '' : 's'}`}
            icon={<IconYouOwe />}
          />
          <StatCard
            label="Pending orders"
            value={`${dashboard.pendingPurchaseOrders}`}
            icon={<IconOrders />}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="You owe suppliers"
            value={formatMoney(dashboard.supplierCredit.totalOutstanding)}
            sub={`${dashboard.supplierCredit.activeAccounts} active credit account${dashboard.supplierCredit.activeAccounts === 1 ? '' : 's'}`}
            icon={<IconYouOwe />}
          />
          <StatCard
            label="Pending orders"
            value={`${dashboard.pendingPurchaseOrders}`}
            icon={<IconOrders />}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent sales" action={<Link to="/sales" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>}>
          {dashboard.recentSales.length === 0 ? (
            <EmptyState message="No sales yet today." />
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

        <SectionCard title="Low stock alerts" action={<Link to="/inventory" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>}>
          {dashboard.inventoryAlerts.lowStockItems.length === 0 ? (
            <EmptyState message="Everything is well stocked. Good job!" />
          ) : (
            <ul className="space-y-2 text-sm">
              {dashboard.inventoryAlerts.lowStockItems.map((item) => (
                <li key={item.productId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-slate-400">{item.sku}</span>{' '}
                    <Link to={`/inventory/${item.productId}`} className="font-medium text-brand-700 hover:underline">{item.name}</Link>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">
                    {item.quantity} left (min {item.minimumStock})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <p className="text-xs text-slate-400">Last updated {new Date(dashboard.generatedAt).toLocaleString()}</p>
    </div>
  );
}
