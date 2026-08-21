import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/auth/AuthContext';

/**
 * Protects routes from unauthenticated access. While the session is being
 * restored the caller sees a loading state instead of a redirect, so an
 * already-logged-in user is not flickered to the login page.
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-slate-500">
        <Spinner />
        <span className="text-sm">Restoring session…</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

/**
 * UX-only admin gate. The backend remains the authoritative enforcement point
 * (requireAdmin); this only hides admin UI from assistants.
 */
export function RequireAdmin() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-slate-500">
        <Spinner />
        <span className="text-sm">Restoring session…</span>
      </div>
    );
  }

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
}