import { Link, NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { appConfig } from '@/config/env';
import { GearMark } from '@/components/ui/GearMark';

interface NavItem {
  to: string;
  label: string;
  /** Match only the exact path (prevents prefix overlaps like /inventory vs /inventory/reservations). */
  end?: boolean;
}

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Quick actions',
    items: [
      { to: '/dashboard', label: 'Dashboard', end: true },
      { to: '/pos', label: 'Point of sale', end: true },
    ],
  },
  {
    heading: 'Catalog',
    items: [
      { to: '/catalog/products', label: 'Products' },
      { to: '/catalog/motorcycles', label: 'Motorcycles' },
      { to: '/catalog/brands', label: 'Brands' },
    ],
  },
  {
    heading: 'Inventory',
    items: [{ to: '/inventory', label: 'Stock levels', end: true }],
  },
  {
    heading: 'Sales',
    items: [{ to: '/sales', label: 'Sales history', end: true }],
  },
  {
    heading: 'Finance',
    items: [
      { to: '/expenses', label: 'Expenses', end: true },
      { to: '/reports', label: 'Reports', end: true },
    ],
  },
  {
    heading: 'Admin',
    items: [{ to: '/settings', label: 'Business settings', end: true }],
  },
];

const linkClasses = ({ isActive }: { isActive: boolean }): string =>
  `block rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive
      ? 'bg-brand-50 font-medium text-brand-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

function BrandMark(): React.ReactElement {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
      <GearMark className="h-8 w-8 text-brand-600" />
      <span className="text-slate-900">
        JM <span className="text-brand-600">SPAREPARTS</span>
      </span>
    </Link>
  );
}

function UserBadge({ compact = false }: { compact?: boolean }): React.ReactElement | null {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <span className={`flex items-center gap-2 ${compact ? '' : 'rounded-lg bg-slate-50 px-3 py-2'}`}>
      <span className={`font-medium text-slate-900 ${compact ? 'text-sm' : 'truncate text-sm'}`}>
        {user.name}
      </span>
      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">{user.role}</span>
    </span>
  );
}

function SignOutButton({ className = '' }: { className?: string }): React.ReactElement {
  const { logout } = useAuth();
  return (
    <button
      type="button"
      onClick={() => void logout()}
      className={`text-sm text-slate-500 hover:text-slate-900 ${className}`}
    >
      Sign out
    </button>
  );
}

function SidebarNav(): React.ReactElement {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.heading}>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {group.heading}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClasses}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function RootLayout() {
  const { status, user } = useAuth();
  const authenticated = status === 'authenticated' && user !== null;

  if (!authenticated) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        <header className="print:hidden border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <BrandMark />
            {status === 'loading' ? (
              <span className="text-sm text-slate-400">…</span>
            ) : (
              <nav className="flex items-center gap-4 text-sm text-slate-600">
                <Link to="/" className="hover:text-slate-900">
                  Home
                </Link>
                <Link to="/login" className="hover:text-slate-900">
                  Sign in
                </Link>
              </nav>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Outlet />
        </main>

        <footer className="print:hidden border-b border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
          {appConfig.name} — {appConfig.tagline}
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ── Full-width hero navbar ── */}
      <header className="print:hidden fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationBell />
          <UserBadge compact />
          <SignOutButton className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900" />
        </div>
      </header>

      {/* ── Desktop sidebar (below navbar) ── */}
      <aside className="print:hidden fixed bottom-0 left-0 top-16 z-40 hidden w-64 overflow-y-auto border-r border-slate-200 bg-white lg:block">
        <SidebarNav />
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-h-screen flex-col pt-16 lg:pl-64">
        {/* Mobile nav pills (below hero navbar) */}
        <nav
          aria-label="Main navigation"
          className="print:hidden sticky top-16 z-30 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 lg:hidden"
        >
          {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  isActive
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Outlet />
        </main>

        <footer className="print:hidden bg-white py-4 text-center text-xs text-slate-400">
          {appConfig.name} — {appConfig.tagline}
        </footer>
      </div>
    </div>
  );
}
