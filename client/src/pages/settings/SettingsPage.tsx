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
      // Only send changed keys.
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
    <div className="space-y-4">
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
    </div>
  );
}
