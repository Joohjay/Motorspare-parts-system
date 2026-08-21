import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GearMark } from '@/components/ui/GearMark';
import { appConfig } from '@/config/env';
import { ApiClientError } from '@/lib/api';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Functional login page. The final decorative JM Spareparts visual design
 * is applied in a later stage; the structure, loading/error states, and
 * authentication wiring are in place now.
 */
export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to sign in right now. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12">
      <GearMark className="h-16 w-16 text-brand-600" />
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
        {appConfig.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{appConfig.tagline}</p>

      <Card className="mt-8 w-full p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <div className="relative mt-1">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-11 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                    <path d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-2.613-2.613A8.53 8.53 0 0 0 18 10c0-3.478-3.582-6.25-8-6.25-1.27 0-2.47.24-3.54.67L3.28 2.22Z" />
                    <path d="M7.31 6.251 8.57 7.51a2.75 2.75 0 0 0 3.919 3.92l1.26 1.26a8.5 8.5 0 0 1-2.75.56c-4.418 0-8-2.772-8-6.25 0-.86.213-1.68.604-2.435L7.31 6.25ZM10.75 9.69l-1.44-1.44a1.25 1.25 0 0 1 1.44 1.44Z" />
                    <path d="M12.256 11.196 15.5 14.44c-.09.058-.182.115-.275.17l-2.97-2.413Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M10 3.75c-4.418 0-8 2.772-8 6.25s3.582 6.25 8 6.25 8-2.772 8-6.25-3.582-6.25-8-6.25Zm0 10a3.75 3.75 0 1 1 0-7.5 3.75 3.75 0 0 1 0 7.5Z"
                      clipRule="evenodd"
                    />
                    <circle cx="10" cy="10" r="2" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center">
          <Link
            to="/forgot-password"
            className="text-sm text-brand-600 hover:text-brand-500"
          >
            Forgot your password?
          </Link>
        </p>
      </Card>

      <Link
        to="/"
        className="mt-4 text-sm text-slate-500 hover:text-slate-700"
      >
        Back to home
      </Link>
    </div>
  );
}