import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GearMark } from '@/components/ui/GearMark';
import { appConfig } from '@/config/env';
import { authApi } from '@/lib/authApi';
import { ApiClientError } from '@/lib/api';

/**
 * Requests a password reset. The response is deliberately generic so it never
 * reveals whether an account exists.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to request a reset right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12">
      <GearMark className="h-12 w-12 text-brand-600" />
      <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
        Reset your password
      </h1>

      <Card className="mt-8 w-full p-6">
        {done ? (
          <p className="text-sm leading-relaxed text-slate-600">
            If an account exists for that email, a password reset link has been
            sent. Check your inbox. In development the link is logged by the
            API.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="forgot-email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}

        <p className="mt-4 text-center">
          <Link
            to="/login"
            className="text-sm text-brand-600 hover:text-brand-500"
          >
            Back to sign in
          </Link>
        </p>
      </Card>

      <p className="mt-4 text-xs text-slate-400">{appConfig.name}</p>
    </div>
  );
}