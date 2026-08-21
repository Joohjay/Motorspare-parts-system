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
import { ApiClientError } from '@/lib/api';
import { productsApi } from '@/lib/catalogApi';
import {
  supplierStatusLabels,
  suppliersApi,
} from '@/lib/purchasingApi';
import type { Supplier, SupplierProduct } from '@/types/api';

const PAGE_SIZE = 25;

interface SupplierFormState {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

const emptyForm: SupplierFormState = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

export function SuppliersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Supplier[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormState>(emptyForm);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [statusTarget, setStatusTarget] = useState<{ supplier: Supplier; next: 'ACTIVE' | 'INACTIVE' } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [productsFor, setProductsFor] = useState<Supplier | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    suppliersApi
      .list({ q: q || undefined, status: status || undefined, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotalPages(data.pagination.totalPages);
        setTotalItems(data.pagination.totalItems);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load suppliers. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, status, page, reloadTick]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function submitForm() {
    if (!form.name.trim()) {
      setFormError('Supplier name is required.');
      return;
    }
    setFormBusy(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) {
        await suppliersApi.update(editing.id, payload);
        setSuccess(`Supplier "${payload.name}" updated.`);
      } else {
        await suppliersApi.create(payload);
        setSuccess(`Supplier "${payload.name}" created.`);
      }
      setFormOpen(false);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Unable to save the supplier. Please try again.',
      );
    } finally {
      setFormBusy(false);
    }
  }

  async function changeStatus() {
    if (!statusTarget) return;
    setStatusBusy(true);
    setActionError(null);
    try {
      await suppliersApi.setStatus(statusTarget.supplier.id, statusTarget.next);
      setSuccess(`Supplier "${statusTarget.supplier.name}" is now ${supplierStatusLabels[statusTarget.next].toLowerCase()}.`);
      setStatusTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiClientError ? err.message : 'Unable to update the supplier status. Please try again.',
      );
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Suppliers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Parts suppliers, their contacts and linked products.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>New supplier</Button>
        )}
      </div>

      {success && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-[220px] flex-1">
          <Field label="Search" htmlFor="supplier-q">
            <TextInput
              id="supplier-q"
              value={q}
              placeholder="Name, contact, phone or email"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Status" htmlFor="supplier-status">
            <SelectInput
              id="supplier-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as '' | 'ACTIVE' | 'INACTIVE');
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </SelectInput>
          </Field>
        </div>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading suppliers…" />
      ) : !items || items.length === 0 ? (
        <EmptyState message="No suppliers match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
            {totalItems} supplier{totalItems === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Credit balance</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{s.name}</div>
                      {s.email && <div className="text-xs text-slate-500">{s.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.contactPerson ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{s.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          s.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-slate-100 text-slate-600 ring-slate-200'
                        }`}
                      >
                        {supplierStatusLabels[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {s.creditAccount && s.creditAccount.status === 'ACTIVE'
                        ? Number(s.creditAccount.outstandingBalance).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => setProductsFor(s)}>
                          Products
                        </Button>
                        {isAdmin && (
                          <>
                            <Button variant="ghost" onClick={() => openEdit(s)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setStatusTarget({ supplier: s, next: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
                              }
                            >
                              {s.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            </Button>
                          </>
                        )}
                      </div>
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

      {formOpen && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New supplier'} onClose={() => setFormOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitForm();
            }}
          >
            <Field label="Name" htmlFor="sup-name" required>
              <TextInput
                id="sup-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact person" htmlFor="sup-contact">
                <TextInput
                  id="sup-contact"
                  value={form.contactPerson}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                />
              </Field>
              <Field label="Phone" htmlFor="sup-phone">
                <TextInput
                  id="sup-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Email" htmlFor="sup-email">
              <TextInput
                id="sup-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Address" htmlFor="sup-address">
              <TextInput
                id="sup-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="Notes" htmlFor="sup-notes">
              <TextInput
                id="sup-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <FormError message={formError} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={formBusy}>
                {formBusy ? 'Saving…' : editing ? 'Save changes' : 'Create supplier'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmDialog
          title={statusTarget.next === 'ACTIVE' ? 'Activate supplier' : 'Deactivate supplier'}
          message={
            statusTarget.next === 'ACTIVE'
              ? `Activate "${statusTarget.supplier.name}"? They will be selectable on purchase orders again.`
              : `Deactivate "${statusTarget.supplier.name}"? They can no longer be selected on new purchase orders.`
          }
          confirmLabel={statusTarget.next === 'ACTIVE' ? 'Activate' : 'Deactivate'}
          busyLabel="Saving…"
          busy={statusBusy}
          onConfirm={() => void changeStatus()}
          onCancel={() => setStatusTarget(null)}
        />
      )}

      {productsFor && (
        <SupplierProductsModal supplier={productsFor} isAdmin={isAdmin} onClose={() => setProductsFor(null)} />
      )}
    </div>
  );
}

function SupplierProductsModal({
  supplier,
  isAdmin,
  onClose,
}: {
  supplier: Supplier;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<SupplierProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<SupplierProduct | null>(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [productOptions, setProductOptions] = useState<{ id: string; name: string; sku: string }[]>([]);

  useEffect(() => {
    let active = true;
    suppliersApi
      .listProducts(supplier.id)
      .then((data) => {
        if (active) setLinks(data.items);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err, 'Unable to load linked products.'));
      });
    productsApi
      .list({ pageSize: 500, status: 'ACTIVE' })
      .then((data) => {
        if (active)
          setProductOptions(data.items.map((p) => ({ id: p.id, name: p.name, sku: p.sku })));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [supplier.id, reloadTick]);

  async function link() {
    if (!productId) {
      setActionError('Choose a product to link.');
      return;
    }
    setLinkBusy(true);
    setActionError(null);
    try {
      await suppliersApi.linkProduct(supplier.id, {
        productId,
        supplierCode: supplierCode.trim() || null,
        unitCost: unitCost.trim() ? Number(unitCost) : null,
      });
      setProductId('');
      setSupplierCode('');
      setUnitCost('');
      setReloadTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to link the product.');
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlink() {
    if (!unlinkTarget) return;
    setUnlinkBusy(true);
    setActionError(null);
    try {
      await suppliersApi.unlinkProduct(unlinkTarget.id);
      setUnlinkTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to unlink the product.');
    } finally {
      setUnlinkBusy(false);
    }
  }

  return (
    <Modal title={`Products supplied by ${supplier.name}`} onClose={onClose} className="max-w-2xl">
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {!error && !links ? (
          <LoadingState label="Loading linked products…" />
        ) : links && links.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">No products linked yet.</p>
        ) : links ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{l.product.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    {l.product.sku}
                    {l.supplierCode ? ` · ${l.supplierCode}` : ''}
                    {l.unitCost ? ` · cost ${Number(l.unitCost).toFixed(2)}` : ''}
                  </div>
                </div>
                {isAdmin && (
                  <Button variant="ghost" onClick={() => setUnlinkTarget(l)}>
                    Unlink
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {isAdmin && (
          <form
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void link();
            }}
          >
            <Field label="Product" htmlFor="link-product" required>
              <SelectInput id="link-product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Choose a product…</option>
                {productOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplier code" htmlFor="link-code">
                <TextInput id="link-code" value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} />
              </Field>
              <Field label="Unit cost" htmlFor="link-cost">
                <TextInput
                  id="link-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={linkBusy}>
                {linkBusy ? 'Linking…' : 'Link product'}
              </Button>
            </div>
          </form>
        )}

        <FormError message={actionError} />

        {unlinkTarget && (
          <ConfirmDialog
            title="Unlink product"
            message={`Remove ${unlinkTarget.product.name} from ${supplier.name}'s catalogue? History is kept.`}
            confirmLabel="Unlink"
            busyLabel="Removing…"
            busy={unlinkBusy}
            onConfirm={() => void unlink()}
            onCancel={() => setUnlinkTarget(null)}
          />
        )}
      </div>
    </Modal>
  );
}
