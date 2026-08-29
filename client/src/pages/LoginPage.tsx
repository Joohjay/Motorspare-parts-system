import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { GearMark } from '@/components/ui/GearMark';
import { appConfig } from '@/config/env';
import { ApiClientError } from '@/lib/api';

interface LocationState {
  from?: { pathname?: string };
}

/** Inline motorcycle silhouette (decorative, local SVG — no network fetch). */
function MotorcycleArt({ className = '' }: { className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 640 320" className={className} role="img" aria-label="Motorcycle illustration">
      <defs>
        <linearGradient id="moto-ink" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
      </defs>
      {/* ground shadow */}
      <ellipse cx="320" cy="284" rx="250" ry="14" fill="#0b1220" opacity="0.12" />
      {/* rear wheel */}
      <g stroke="#1e293b" fill="none">
        <circle cx="150" cy="230" r="58" strokeWidth="14" />
        <circle cx="150" cy="230" r="30" strokeWidth="8" stroke="#334155" />
        {[0, 45, 90, 135].map((angle) => (
          <line
            key={angle}
            x1={150 + 30 * Math.cos((angle * Math.PI) / 180)}
            y1={230 + 30 * Math.sin((angle * Math.PI) / 180)}
            x2={150 - 30 * Math.cos((angle * Math.PI) / 180)}
            y2={230 - 30 * Math.sin((angle * Math.PI) / 180)}
            strokeWidth="5"
            stroke="#334155"
          />
        ))}
      </g>
      {/* front wheel */}
      <g stroke="#1e293b" fill="none">
        <circle cx="492" cy="230" r="58" strokeWidth="14" />
        <circle cx="492" cy="230" r="30" strokeWidth="8" stroke="#334155" />
        {[0, 45, 90, 135].map((angle) => (
          <line
            key={angle}
            x1={492 + 30 * Math.cos((angle * Math.PI) / 180)}
            y1={230 + 30 * Math.sin((angle * Math.PI) / 180)}
            x2={492 - 30 * Math.cos((angle * Math.PI) / 180)}
            y2={230 - 30 * Math.sin((angle * Math.PI) / 180)}
            strokeWidth="5"
            stroke="#334155"
          />
        ))}
      </g>
      {/* body */}
      <path
        d="M150 230
           L232 168
           C258 148 292 138 330 140
           L392 144
           C420 146 442 158 458 178
           L492 230"
        fill="none"
        stroke="url(#moto-ink)"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* seat + tank */}
      <path d="M236 160 C270 132 306 122 340 124 C368 126 388 134 402 150 L352 152 C312 154 268 156 236 160 Z" fill="#0f172a" />
      {/* fork + handlebar */}
      <path d="M492 230 L448 130 M430 118 L462 108" stroke="#334155" strokeWidth="12" strokeLinecap="round" fill="none" />
      {/* headlight */}
      <circle cx="452" cy="128" r="10" fill="#fbbf24" />
      {/* exhaust */}
      <path d="M300 208 L392 214" stroke="#94a3b8" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Sign-in page with the JM Spareparts motorcycle identity (Stage 8):
 * a split layout with the brand story on one side and the credential form
 * on the other. Purely decorative artwork is inline SVG so it works offline.
 */
export function LoginPage(): ReactElement {
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
    <div className="mx-auto grid min-h-[70vh] max-w-5xl items-center gap-10 py-10 lg:grid-cols-2">
      {/* Brand panel */}
      <section className="order-2 hidden flex-col items-center justify-center rounded-3xl bg-slate-950 p-10 text-white lg:order-1 lg:flex">
        <div className="flex items-center gap-3">
          <GearMark className="h-10 w-10 text-brand-500" />
          <span className="text-lg font-bold uppercase tracking-widest">{appConfig.name}</span>
        </div>
        <MotorcycleArt className="mt-8 w-full max-w-md" />
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight">Motorcycle Spare Parts Management System</h2>
        <p className="mt-3 max-w-sm text-center text-sm leading-relaxed text-slate-400">
          Stock levels, point of sale and expenses — everything that keeps
          the wheels of the shop turning, in one place.
        </p>
      </section>

      {/* Form panel */}
      <section className="order-1 mx-auto w-full max-w-md lg:order-2">
        <div className="mb-6 text-center lg:hidden">
          <GearMark className="mx-auto h-14 w-14 text-brand-600" />
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{appConfig.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{appConfig.tagline}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="hidden text-xl font-bold tracking-tight text-slate-900 lg:block">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use your shop account to continue.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
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
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
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
                      <path fillRule="evenodd" d="M10 3.75c-4.418 0-8 2.772-8 6.25s3.582 6.25 8 6.25 8-2.772 8-6.25-3.582-6.25-8-6.25Zm0 10a3.75 3.75 0 1 1 0-7.5 3.75 3.75 0 0 1 0 7.5Z" clipRule="evenodd" />
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
            <Link to="/forgot-password" className="text-sm text-brand-600 hover:text-brand-500">
              Forgot your password?
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400 lg:hidden">
          {appConfig.name} — Motorcycle Spare Parts Management System
        </p>

        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">
            Back to home
          </Link>
        </div>
      </section>
    </div>
  );
}
