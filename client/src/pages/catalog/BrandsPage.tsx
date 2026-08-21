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
import { brandsApi } from '@/lib/catalogApi';
import type { Brand } from '@/types/api';

type TargetAction = { brand: Brand; status: 'ACTIVE' | 'INACTIVE' } | null;

export function BrandsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editing, setEditing] = useState<Brand | 'new' | null>(null);
  const [target, setTarget] = useState<TargetAction>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    brandsApi
      .list({
        q: q || undefined,
        status: (status as 'ACTIVE' | 'INACTIVE') || undefined,
        page,
        pageSize,
        sortBy: 'name',
        sortOrder: 'asc',
      })
      .then((data) => {
        if (!active) return;
        setBrands(data.items);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load brands. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, status, page, pageSize, reloadTick]);

  async function confirmToggle() {
    if (!target) return;
    setMutating(true);
    try {
      await brandsApi.setStatus(target.brand.id, target.status);
      setTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update brand status. Please try again.';
      setError(message);
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Brands</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manufacturers and suppliers of spare parts.
          </p>
        </div>
        {isAdmin && <Button onClick={() => setEditing('new')}>New brand</Button>}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="brand-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <TextInput
              id="brand-search"
              placeholder="Brand name…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label htmlFor="brand-status" className="block text-sm font-medium text-slate-700">
              Status
            </label>
            <SelectInput
              id="brand-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </SelectInput>
          </div>
        </div>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading brands…" />
      ) : !brands || brands.length === 0 ? (
        <EmptyState message="No brands match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 text-center font-medium">Products</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {brands.map((brand) => (
                  <tr key={brand.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{brand.name}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{brand.productCount}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={brand.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-1">
                          <Button variant="ghost" onClick={() => setEditing(brand)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setTarget({
                                brand,
                                status: brand.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              })
                            }
                          >
                            {brand.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
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
        <BrandFormDialog
          brand={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {target && (
        <ConfirmDialog
          title={target.status === 'INACTIVE' ? 'Deactivate brand' : 'Activate brand'}
          message={`${target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'} "${target.brand.name}"? Deactivating is blocked while products still reference the brand.`}
          confirmLabel={target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'}
          busy={mutating}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}

interface BrandFormDialogProps {
  brand: Brand | null;
  onClose: () => void;
  onSaved: () => void;
}

function BrandFormDialog({ brand, onClose, onSaved }: BrandFormDialogProps) {
  const isEdit = brand !== null;
  const [name, setName] = useState(brand?.name ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await brandsApi.update(brand.id, { name: name.trim() });
      } else {
        await brandsApi.create({ name: name.trim() });
      }
      onSaved();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : `Unable to ${isEdit ? 'update' : 'create'} the brand. Please try again.`;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit brand' : 'New brand'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" htmlFor="brand-name" required>
          <TextInput
            id="brand-name"
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
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create brand'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}