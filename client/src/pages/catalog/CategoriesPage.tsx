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
  TextArea,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiClientError } from '@/lib/api';
import { categoriesApi } from '@/lib/catalogApi';
import type { Category } from '@/types/api';

type TargetAction = { category: Category; status: 'ACTIVE' | 'INACTIVE' } | null;

export function CategoriesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [target, setTarget] = useState<TargetAction>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    categoriesApi
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
        setCategories(data.items);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load categories. Please try again.'));
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
      await categoriesApi.setStatus(target.category.id, target.status);
      setTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update category status. Please try again.';
      setError(message);
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Categories</h1>
          <p className="mt-1 text-sm text-slate-500">
            Organize spare parts into a browsable hierarchy.
          </p>
        </div>
        {isAdmin && <Button onClick={() => setEditing('new')}>New category</Button>}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="category-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <TextInput
              id="category-search"
              placeholder="Name or slug…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label htmlFor="category-status" className="block text-sm font-medium text-slate-700">
              Status
            </label>
            <SelectInput
              id="category-status"
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
        <LoadingState label="Loading categories…" />
      ) : !categories || categories.length === 0 ? (
        <EmptyState message="No categories match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Parent</th>
                  <th className="px-4 py-3 text-center font-medium">Products</th>
                  <th className="px-4 py-3 text-center font-medium">Subcategories</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((category) => (
                  <tr key={category.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{category.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{category.slug}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {category.parentId ? categories.find((c) => c.id === category.parentId)?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{category.productCount}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{category.childCount}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={category.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-1">
                          <Button variant="ghost" onClick={() => setEditing(category)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setTarget({
                                category,
                                status: category.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              })
                            }
                          >
                            {category.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
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
        <CategoryFormDialog
          category={editing === 'new' ? null : editing}
          categories={categories ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {target && (
        <ConfirmDialog
          title={target.status === 'INACTIVE' ? 'Deactivate category' : 'Activate category'}
          message={`${target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'} "${target.category.name}"? Deactivating is blocked while products still reference the category.`}
          confirmLabel={target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'}
          busy={mutating}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}

interface CategoryFormDialogProps {
  category: Category | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

function CategoryFormDialog({ category, categories, onClose, onSaved }: CategoryFormDialogProps) {
  const isEdit = category !== null;
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        parentId: parentId || null,
        description: description.trim() || null,
      };
      if (isEdit) {
        await categoriesApi.update(category.id, input);
      } else {
        await categoriesApi.create(input);
      }
      onSaved();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : `Unable to ${isEdit ? 'update' : 'create'} the category. Please try again.`;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit category' : 'New category'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" htmlFor="category-name" required>
          <TextInput
            id="category-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Parent category" htmlFor="category-parent" hint="Leave empty for a top-level category.">
          <SelectInput
            id="category-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Top level</option>
            {categories
              .filter((c) => c.id !== category?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectInput>
        </Field>
        <Field label="Description" htmlFor="category-description">
          <TextArea
            id="category-description"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create category'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}