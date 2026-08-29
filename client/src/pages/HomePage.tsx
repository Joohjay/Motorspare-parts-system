import { Link, Navigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { appConfig } from '@/config/env';
import { useHealth } from '@/hooks/useHealth';

export function HomePage() {
  const { status } = useAuth();
  const { data, loading, error } = useHealth();

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl bg-slate-950 p-8 text-white">
        <h1 className="text-3xl font-bold tracking-tight">{appConfig.name}</h1>
        <p className="mt-2 text-slate-300">{appConfig.tagline}</p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
          Professional system for motorcycle spare parts management — catalog,
          purchasing, inventory, retail and wholesale sales, discounts,
          payments, expenses and reporting.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium hover:bg-brand-500"
        >
          Sign in
        </Link>
      </section>

      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          System status
        </h2>
        <div className="mt-4 flex items-center gap-3">
          {loading ? (
            <>
              <Spinner />
              <span className="text-sm text-slate-500">Checking API…</span>
            </>
          ) : error ? (
            <>
              <StatusBadge status="error" />
              <span className="text-sm text-slate-600">{error}</span>
            </>
          ) : (
            <>
              <StatusBadge status={data?.database ?? 'down'} />
              <span className="text-sm text-slate-600">
                API {data?.status}. Database {data?.database ?? 'unknown'}.
              </span>
            </>
          )}
        </div>

        {data && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Service</dt>
              <dd className="font-medium">{data.service}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Uptime</dt>
              <dd className="font-medium">{Math.round(data.uptime)}s</dd>
            </div>
          </dl>
        )}
      </Card>
    </div>
  );
}