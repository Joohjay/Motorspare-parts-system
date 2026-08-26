import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  ErrorState,
  Field,
  FormError,
  LoadingState,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { authApi } from '@/lib/authApi';
import { settingsApi } from '@/lib/stage8Api';
import type { BusinessSettings as BusinessSettingsShape } from '@/types/api';

const EDITABLE_FIELDS: Array<{ key: keyof BusinessSettingsShape; label: string; placeholder?: string }> = [
  { key: 'business.name', label: 'Business name', placeholder: 'JM SPAREPARTS' },
  { key: 'business.phone', label: 'Phone', placeholder: '+255 …' },
  { key: 'business.email', label: 'Email', placeholder: 'info@…' },
  { key: 'business.address', label: 'Address', placeholder: 'Street, city' },
  { key: 'business.currency', label: 'Currency code', placeholder: 'TZS' },
  { key: 'business.timezone', label: 'Timezone', placeholder: 'Africa/Nairobi' },
  { key: 'business.receiptFooter', label: 'Receipt footer message', placeholder: 'Thank you for your business' },
];

type UserSummary = { id: string; fullName: string; email: string; role: string; status: string };

function ChangeOwnPasswordCard(): ReactElement {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      await authApi.changeOwnPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(errorMessage(err, 'Could not change password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Change your password</h2>
      <div className="mt-4 space-y-4">
        <Field label="Current password" htmlFor="current-password">
          <TextInput
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); setSuccess(false); }}
            disabled={busy}
          />
        </Field>
        <Field label="New password" htmlFor="new-password">
          <TextInput
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setSuccess(false); }}
            disabled={busy}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <TextInput
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setSuccess(false); }}
            disabled={busy}
          />
        </Field>
      </div>
      <FormError message={error} />
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => void submit()} disabled={busy || !currentPassword || !newPassword || !confirm}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
        {success && !error ? <span className="text-sm font-medium text-emerald-700">Password changed.</span> : null}
      </div>
    </Card>
  );
}

function AdminResetAssistantCard(): ReactElement {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const { users: list } = await authApi.listUsers();
      setUsers(list);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load users'));
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const submit = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      await authApi.adminResetPassword(selectedId, newPassword);
      const target = users.find((u) => u.id === selectedId);
      setSuccess(`Password reset for ${target?.fullName ?? 'user'}.`);
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(errorMessage(err, 'Could not reset password.'));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} />;
  if (users.length === 0) return <LoadingState label="Loading users…" />;

  return (
    <Card className="max-w-xl p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Reset assistant password</h2>
      <p className="mt-1 text-xs text-slate-400">Select a user and set a new password. Their active sessions will be invalidated.</p>
      <div className="mt-4 space-y-4">
        <Field label="User" htmlFor="reset-user">
          <select
            id="reset-user"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setSuccess(null); }}
            disabled={busy}
          >
            <option value="">— Select a user —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.role}){u.status !== 'ACTIVE' ? ' — inactive' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="New password" htmlFor="admin-new-password">
          <TextInput
            id="admin-new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setSuccess(null); }}
            disabled={busy}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="admin-confirm-password">
          <TextInput
            id="admin-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setSuccess(null); }}
            disabled={busy}
          />
        </Field>
      </div>
      <FormError message={error} />
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => void submit()} disabled={busy || !selectedId || !newPassword || !confirm}>
          {busy ? 'Resetting…' : 'Reset password'}
        </Button>
        {success && !error ? <span className="text-sm font-medium text-emerald-700">{success}</span> : null}
      </div>
    </Card>
  );
}

export function SettingsPage(): ReactElement {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await settingsApi.get();
      setSettings(response.settings);
      setDraft(response.settings);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load settings'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!settings) return <LoadingState label="Loading settings…" />;

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      const changed: Record<string, string> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (value !== settings[key]) changed[key] = value;
      }
      if (Object.keys(changed).length === 0) {
        setSaved(true);
        return;
      }
      const response = await settingsApi.update(changed as Partial<BusinessSettingsShape>);
      setSettings(response.settings);
      setDraft(response.settings);
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save settings'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Business settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          These details appear on printed receipts and around the app.
          {!isAdmin ? ' Only admins can change them.' : ''}
        </p>
      </div>

      <Card className="max-w-xl p-6">
        <div className="space-y-4">
          {EDITABLE_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} htmlFor={`setting-${field.key}`}>
              <TextInput
                id={`setting-${field.key}`}
                value={draft[field.key] ?? ''}
                placeholder={field.placeholder}
                disabled={!isAdmin || busy}
                onChange={(event) => {
                  setSaved(false);
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                }}
              />
            </Field>
          ))}
        </div>

        <FormError message={saveError} />

        <div className="mt-5 flex items-center gap-3">
          {isAdmin ? (
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          ) : null}
          {saved && !saveError ? <span className="text-sm font-medium text-emerald-700">Saved.</span> : null}
        </div>
      </Card>

      <ChangeOwnPasswordCard />

      {isAdmin ? <AdminResetAssistantCard /> : null}
    </div>
  );
}
