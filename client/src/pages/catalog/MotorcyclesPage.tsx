import { useEffect, useState } from 'react';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiClientError } from '@/lib/api';
import { motorcyclesApi } from '@/lib/catalogApi';
import type {
  MotorcycleMake,
  MotorcycleModel,
  MotorcycleVariant,
} from '@/types/api';

type Tab = 'makes' | 'models' | 'variants';

const tabs: { id: Tab; label: string }[] = [
  { id: 'makes', label: 'Makes' },
  { id: 'models', label: 'Models' },
  { id: 'variants', label: 'Variants' },
];

export function MotorcyclesPage() {
  const [tab, setTab] = useState<Tab>('makes');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Motorcycle catalog
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          The make → model → variant structure used for product compatibility.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'makes' && <MakesTab />}
      {tab === 'models' && <ModelsTab />}
      {tab === 'variants' && <VariantsTab />}
    </div>
  );
}

function useAdmin() {
  const { user } = useAuth();
  return user?.role === 'ADMIN';
}

// ---------------------------------------------------------------------------
// Makes
// ---------------------------------------------------------------------------

type MakeTarget = { make: MotorcycleMake; status: 'ACTIVE' | 'INACTIVE' } | null;

function MakesTab() {
  const isAdmin = useAdmin();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [makes, setMakes] = useState<MotorcycleMake[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editing, setEditing] = useState<MotorcycleMake | 'new' | null>(null);
  const [target, setTarget] = useState<MakeTarget>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    motorcyclesApi
      .listMakes({ q: q || undefined, page, pageSize, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (!active) return;
        setMakes(data.items);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load makes. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, page, pageSize, reloadTick]);

  async function confirmToggle() {
    if (!target) return;
    setMutating(true);
    try {
      await motorcyclesApi.setMakeStatus(target.make.id, target.status);
      setTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update make status. Please try again.';
      setError(message);
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Card className="flex-1 p-4">
          <label htmlFor="make-search" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <TextInput
            id="make-search"
            placeholder="Make name…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </Card>
        {isAdmin && <Button onClick={() => setEditing('new')}>New make</Button>}
      </div>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading makes…" />
      ) : !makes || makes.length === 0 ? (
        <EmptyState message="No makes match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 text-center font-medium">Models</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {makes.map((make) => (
                  <tr key={make.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{make.name}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{make.modelCount}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={make.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-1">
                          <Button variant="ghost" onClick={() => setEditing(make)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setTarget({
                                make,
                                status: make.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              })
                            }
                          >
                            {make.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </Card>
      )}

      {editing && (
        <MakeFormDialog
          make={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {target && (
        <ConfirmDialog
          title={target.status === 'INACTIVE' ? 'Deactivate make' : 'Activate make'}
          message={`${target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'} "${target.make.name}"? Deactivating is blocked while product compatibility still references it.`}
          confirmLabel={target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'}
          busy={mutating}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}

interface MakeFormDialogProps {
  make: MotorcycleMake | null;
  onClose: () => void;
  onSaved: () => void;
}

function MakeFormDialog({ make, onClose, onSaved }: MakeFormDialogProps) {
  const isEdit = make !== null;
  const [name, setName] = useState(make?.name ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await motorcyclesApi.updateMake(make.id, { name: name.trim() });
      } else {
        await motorcyclesApi.createMake({ name: name.trim() });
      }
      onSaved();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : `Unable to ${isEdit ? 'update' : 'create'} the make. Please try again.`;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit make' : 'New make'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" htmlFor="make-name" required>
          <TextInput
            id="make-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create make'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

type ModelTarget = { model: MotorcycleModel; status: 'ACTIVE' | 'INACTIVE' } | null;

function ModelsTab() {
  const isAdmin = useAdmin();
  const [q, setQ] = useState('');
  const [makeFilter, setMakeFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [models, setModels] = useState<MotorcycleModel[] | null>(null);
  const [makes, setMakes] = useState<MotorcycleMake[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editing, setEditing] = useState<MotorcycleModel | 'new' | null>(null);
  const [target, setTarget] = useState<ModelTarget>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    motorcyclesApi
      .listModels({
        q: q || undefined,
        makeId: makeFilter || undefined,
        page,
        pageSize,
        sortBy: 'name',
        sortOrder: 'asc',
      })
      .then((data) => {
        if (!active) return;
        setModels(data.items);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load models. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, makeFilter, page, pageSize, reloadTick]);

  useEffect(() => {
    let active = true;
    motorcyclesApi
      .listMakes({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (active) setMakes(data.items);
      })
      .catch(() => {
        // Filter options are non-critical.
      });
    return () => {
      active = false;
    };
  }, []);

  async function confirmToggle() {
    if (!target) return;
    setMutating(true);
    try {
      await motorcyclesApi.setModelStatus(target.model.id, target.status);
      setTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update model status. Please try again.';
      setError(message);
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Card className="flex-1 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="model-search" className="block text-sm font-medium text-slate-700">
                Search
              </label>
              <TextInput
                id="model-search"
                placeholder="Model name…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label htmlFor="model-make" className="block text-sm font-medium text-slate-700">
                Make
              </label>
              <SelectInput
                id="model-make"
                value={makeFilter}
                onChange={(e) => {
                  setMakeFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All makes</option>
                {makes.map((make) => (
                  <option key={make.id} value={make.id}>
                    {make.name}
                  </option>
                ))}
              </SelectInput>
            </div>
          </div>
        </Card>
        {isAdmin && <Button onClick={() => setEditing('new')}>New model</Button>}
      </div>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading models…" />
      ) : !models || models.length === 0 ? (
        <EmptyState message="No models match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Make</th>
                  <th className="px-4 py-3 text-center font-medium">Variants</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {models.map((model) => (
                  <tr key={model.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{model.name}</td>
                    <td className="px-4 py-3 text-slate-600">{model.make.name}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{model.variantCount}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={model.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-1">
                          <Button variant="ghost" onClick={() => setEditing(model)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setTarget({
                                model,
                                status: model.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              })
                            }
                          >
                            {model.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </Card>
      )}

      {editing && (
        <ModelFormDialog
          model={editing === 'new' ? null : editing}
          makes={makes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {target && (
        <ConfirmDialog
          title={target.status === 'INACTIVE' ? 'Deactivate model' : 'Activate model'}
          message={`${target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'} "${target.model.name}"? Deactivating is blocked while product compatibility still references it.`}
          confirmLabel={target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'}
          busy={mutating}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}

interface ModelFormDialogProps {
  model: MotorcycleModel | null;
  makes: MotorcycleMake[];
  onClose: () => void;
  onSaved: () => void;
}

function ModelFormDialog({ model, makes, onClose, onSaved }: ModelFormDialogProps) {
  const isEdit = model !== null;
  const [name, setName] = useState(model?.name ?? '');
  const [makeId, setMakeId] = useState(model?.makeId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await motorcyclesApi.updateModel(model.id, { name: name.trim() });
      } else {
        if (!makeId) {
          setError('Please choose a make.');
          setSubmitting(false);
          return;
        }
        await motorcyclesApi.createModel({ makeId, name: name.trim() });
      }
      onSaved();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : `Unable to ${isEdit ? 'update' : 'create'} the model. Please try again.`;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit model' : 'New model'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <Field label="Make" htmlFor="model-make" required>
            <SelectInput
              id="model-make"
              required
              value={makeId}
              onChange={(e) => setMakeId(e.target.value)}
            >
              <option value="">Choose a make…</option>
              {makes.map((make) => (
                <option key={make.id} value={make.id}>
                  {make.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="Name" htmlFor="model-name" required>
          <TextInput
            id="model-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create model'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

type VariantTarget = { variant: MotorcycleVariant; status: 'ACTIVE' | 'INACTIVE' } | null;

function VariantsTab() {
  const isAdmin = useAdmin();
  const [q, setQ] = useState('');
  const [makeFilter, setMakeFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [variants, setVariants] = useState<MotorcycleVariant[] | null>(null);
  const [makes, setMakes] = useState<MotorcycleMake[]>([]);
  const [models, setModels] = useState<MotorcycleModel[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editing, setEditing] = useState<MotorcycleVariant | 'new' | null>(null);
  const [target, setTarget] = useState<VariantTarget>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    motorcyclesApi
      .listVariants({
        q: q || undefined,
        makeId: makeFilter || undefined,
        modelId: modelFilter || undefined,
        page,
        pageSize,
        sortBy: 'name',
        sortOrder: 'asc',
      })
      .then((data) => {
        if (!active) return;
        setVariants(data.items);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load variants. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, makeFilter, modelFilter, page, pageSize, reloadTick]);

  useEffect(() => {
    let active = true;
    motorcyclesApi
      .listMakes({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (active) setMakes(data.items);
      })
      .catch(() => {
        // Filter options are non-critical.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!makeFilter) {
      setModels([]);
      setModelFilter('');
      return;
    }
    let active = true;
    motorcyclesApi
      .listModels({ makeId: makeFilter, pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (active) {
          setModels(data.items);
          setModelFilter('');
        }
      })
      .catch(() => {
        if (active) {
          setModels([]);
          setModelFilter('');
        }
      });
    return () => {
      active = false;
    };
  }, [makeFilter]);

  async function confirmToggle() {
    if (!target) return;
    setMutating(true);
    try {
      await motorcyclesApi.setVariantStatus(target.variant.id, target.status);
      setTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update variant status. Please try again.';
      setError(message);
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Card className="flex-1 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="variant-search" className="block text-sm font-medium text-slate-700">
                Search
              </label>
              <TextInput
                id="variant-search"
                placeholder="Variant name…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label htmlFor="variant-make" className="block text-sm font-medium text-slate-700">
                Make
              </label>
              <SelectInput
                id="variant-make"
                value={makeFilter}
                onChange={(e) => {
                  setMakeFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All makes</option>
                {makes.map((make) => (
                  <option key={make.id} value={make.id}>
                    {make.name}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <label htmlFor="variant-model" className="block text-sm font-medium text-slate-700">
                Model
              </label>
              <SelectInput
                id="variant-model"
                value={modelFilter}
                onChange={(e) => {
                  setModelFilter(e.target.value);
                  setPage(1);
                }}
                disabled={!makeFilter}
              >
                <option value="">All models</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </SelectInput>
            </div>
          </div>
        </Card>
        {isAdmin && <Button onClick={() => setEditing('new')}>New variant</Button>}
      </div>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading variants…" />
      ) : !variants || variants.length === 0 ? (
        <EmptyState message="No variants match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Motorcycle</th>
                  <th className="px-4 py-3 font-medium">Year range</th>
                  <th className="px-4 py-3 text-center font-medium">Fits products</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map((variant) => (
                  <tr key={variant.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{variant.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {variant.model.make.name} {variant.model.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {variant.yearFrom
                        ? `${variant.yearFrom}–${variant.yearTo ?? 'now'}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {variant.compatibilityCount}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={variant.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-1">
                          <Button variant="ghost" onClick={() => setEditing(variant)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setTarget({
                                variant,
                                status: variant.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              })
                            }
                          >
                            {variant.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </Card>
      )}

      {editing && (
        <VariantFormDialog
          variant={editing === 'new' ? null : editing}
          makes={makes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {target && (
        <ConfirmDialog
          title={target.status === 'INACTIVE' ? 'Deactivate variant' : 'Activate variant'}
          message={`${target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'} "${target.variant.name}"? Deactivating is blocked while product compatibility still references it.`}
          confirmLabel={target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'}
          busy={mutating}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}

interface VariantFormDialogProps {
  variant: MotorcycleVariant | null;
  makes: MotorcycleMake[];
  onClose: () => void;
  onSaved: () => void;
}

function VariantFormDialog({ variant, makes, onClose, onSaved }: VariantFormDialogProps) {
  const isEdit = variant !== null;
  const [name, setName] = useState(variant?.name ?? '');
  const [makeId, setMakeId] = useState(variant?.model.make.id ?? '');
  const [modelId, setModelId] = useState(variant?.modelId ?? '');
  const [yearFrom, setYearFrom] = useState(variant?.yearFrom ? String(variant.yearFrom) : '');
  const [yearTo, setYearTo] = useState(variant?.yearTo ? String(variant.yearTo) : '');
  const [models, setModels] = useState<MotorcycleModel[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEdit) {
      setModels([]);
      return;
    }
    if (!makeId) {
      setModels([]);
      return;
    }
    let active = true;
    motorcyclesApi
      .listModels({ makeId, pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (active) setModels(data.items);
      })
      .catch(() => {
        if (active) setModels([]);
      });
    return () => {
      active = false;
    };
  }, [makeId, isEdit]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const from = yearFrom ? Number(yearFrom) : null;
    const to = yearTo ? Number(yearTo) : null;
    if (from != null && !Number.isInteger(from)) {
      setError('Year from must be a whole number.');
      setSubmitting(false);
      return;
    }
    if (to != null && !Number.isInteger(to)) {
      setError('Year to must be a whole number.');
      setSubmitting(false);
      return;
    }
    if (from != null && to != null && from > to) {
      setError('Year from cannot be after year to.');
      setSubmitting(false);
      return;
    }

    try {
      if (isEdit) {
        await motorcyclesApi.updateVariant(variant.id, {
          name: name.trim(),
          yearFrom: from,
          yearTo: to,
        });
      } else {
        if (!modelId) {
          setError('Please choose a model.');
          setSubmitting(false);
          return;
        }
        await motorcyclesApi.createVariant({
          modelId,
          name: name.trim(),
          yearFrom: from,
          yearTo: to,
        });
      }
      onSaved();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : `Unable to ${isEdit ? 'update' : 'create'} the variant. Please try again.`;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit variant' : 'New variant'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Make" htmlFor="variant-make" required>
              <SelectInput
                id="variant-make"
                required
                value={makeId}
                onChange={(e) => {
                  setMakeId(e.target.value);
                  setModelId('');
                }}
              >
                <option value="">Choose a make…</option>
                {makes.map((make) => (
                  <option key={make.id} value={make.id}>
                    {make.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Model" htmlFor="variant-model" required>
              <SelectInput
                id="variant-model"
                required
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!makeId}
              >
                <option value="">Choose a model…</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        )}
        <Field label="Name" htmlFor="variant-name" required>
          <TextInput
            id="variant-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Year from" htmlFor="variant-yearfrom">
            <TextInput
              id="variant-yearfrom"
              type="number"
              min={1900}
              max={2100}
              step={1}
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
            />
          </Field>
          <Field label="Year to" htmlFor="variant-yearto">
            <TextInput
              id="variant-yearto"
              type="number"
              min={1900}
              max={2100}
              step={1}
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
            />
          </Field>
        </div>
        <FormError message={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create variant'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}