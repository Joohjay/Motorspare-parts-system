import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * Authenticated landing placeholder. Business modules arrive in later stages;
 * this establishes the authenticated shell (session restoration, user info,
 * logout, admin/assistant awareness) that those modules build on.
 */
export function DashboardPage() {
  const { user, logout, status } = useAuth();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-slate-950 p-8 text-white">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.name ?? 'user'}
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          You are signed in as{' '}
          <span className="font-semibold text-white">{user?.role ?? '—'}</span>.
          Business modules are added in the upcoming stages.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Account
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium">{user?.name}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium">{user?.email}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Role</dt>
              <dd className="font-medium">{user?.role}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${user?.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}
                >
                  {user?.status ?? 'Unknown'}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Last sign in</dt>
              <dd className="font-medium">
                {user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
              </dd>
            </div>
          </dl>
          <Button
            variant="secondary"
            className="mt-6"
            disabled={status !== 'authenticated'}
            onClick={() => void logout()}
          >
            Sign out
          </Button>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Next steps
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            Product catalog, inventory, sales, purchasing, credit, and expense
            modules will appear here in later stages. The authentication and
            authorization foundation is complete and enforced on the backend.
          </p>
        </Card>
      </div>
    </div>
  );
}