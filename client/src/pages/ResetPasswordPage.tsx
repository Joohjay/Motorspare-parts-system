import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GearMark } from '@/components/ui/GearMark';
import { appConfig } from '@/config/env';
import { authApi } from '@/lib/authApi';
import { ApiClientError } from '@/lib/api';

const PASSWORD_MIN_LENGTH = 12;

/**
 * Sets a new password using a token from the reset link. The password policy
 * matches the backend (at least 12 characters, letter + number).
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to reset your password right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12">
      <GearMark className="h-12 w-12 text-brand-600" />
      <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
        Choose a new password
      </h1>

      <Card className="mt-8 w-full p-6">
        {done ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              Your password has been reset. You can now sign in with your new
              password.
            </p>
            <Link to="/login" className="block text-center">
              <Button className="w-full">Go to sign in</Button>
            </Link>
          </div>
        ) : !token ? (
          <p className="text-sm text-red-700">
            This reset link is missing its token. Request a new password reset.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="reset-password"
                className="block text-sm font-medium text-slate-700"
              >
                New password
              </label>
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <p className="mt-1 text-xs text-slate-400">
                At least {PASSWORD_MIN_LENGTH} characters with a letter and a number.
              </p>
            </div>

            <div>
              <label
                htmlFor="reset-confirm"
                className="block text-sm font-medium text-slate-700"
              >
                Confirm new password
              </label>
              <input
                id="reset-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Resetting…' : 'Reset password'}
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