import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  EmptyState,
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
import { customerStatusLabels, customerTypeLabels, customersApi } from '@/lib/customersApi';
import { formatCurrency } from '@/lib/inventoryApi';
import type { CustomerInput, CustomerListItem, CustomerType } from '@/types/api';

const EMPTY_FORM: CustomerInput = { name: '', phone: '', email: '', address: '', notes: '', type: 'RETAIL' };

export function CustomersPage(): ReactElement {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [pageData, setPageData] = useState<CustomerListItem[] | null>(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<CustomerListItem | 'new' | null>(null);
  const [form, setForm] = useState<CustomerInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [statusTarget, setStatusTarget] = useState<CustomerListItem | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(
    async (page = 1) => {
      setListError(null);
      try {
        const result = await customersApi.list({
          q: query || undefined,
          type: (typeFilter || undefined) as CustomerType | undefined,
          page,
          pageSize: 10,
        });
        setPageData(result.items);
        setPagination({ page: result.pagination.page, totalPages: result.pagination.totalPages });
      } catch (err) {
        setListError(errorMessage(err, 'Could not load customers'));
      }
    },
    [query, typeFilter],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const openCreate = (): void => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing('new');
  };

  const openEdit = (customer: CustomerListItem): void => {
    setForm({
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
      type: customer.type,
    });
    setFormError(null);
    setEditing(customer);
  };

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      setFormError('Name is required');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await customersApi.create(form);
      } else if (editing) {
        await customersApi.update(editing.id, form);
      }
      setEditing(null);
      await load(pagination.page);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save the customer'));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (): Promise<void> => {
    if (!statusTarget) return;
    setToggling(true);
    try {
      await customersApi.setStatus(
        statusTarget.id,
        statusTarget.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      );
      setStatusTarget(null);
      await load(pagination.page);
    } catch (err) {
      setListError(errorMessage(err, 'Could not change the customer status'));
      setStatusTarget(null);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500">Retail walk-ins, garages and credit accounts.</p>
        </div>
        {isAdmin && <Button onClick={openCreate}>New customer</Button>}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1);
        }}
      >
        <TextInput
          placeholder="Search name, phone or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <SelectInput value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="max-w-[12rem]">
          <option value="">All types</option>
          {Object.entries(customerTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
        <Button variant="secondary" type="submit">
          Filter
        </Button>
      </form>

      <FormError message={listError} />

      {pageData === null ? (
        <LoadingState />
      ) : pageData.length === 0 ? (
        <EmptyState message="No customers found." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Credit balance</th>
                <th className="px-4 py-3">Sales</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pageData.map((customer) => (
                <tr key={customer.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link to={`/customers/${customer.id}`} className="font-medium text-brand-700 hover:underline">
                      {customer.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{customerTypeLabels[customer.type]}</td>
                  <td className="px-4 py-3">{customer.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    {customer.creditAccount
                      ? formatCurrency(customer.creditAccount.outstandingBalance)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">{customer.salesCount}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        customer.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-slate-100 text-slate-600 ring-slate-200'
                      }`}
                    >
                      {customerStatusLabels[customer.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() => openEdit(customer)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ml-3 text-xs text-red-600 hover:underline"
                          onClick={() => setStatusTarget(customer)}
                        >
                          {customer.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationControls
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(page) => void load(page)}
      />

      {editing && (
        <Modal
          title={editing === 'new' ? 'New customer' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="Name" htmlFor="customer-name" required>
              <TextInput
                id="customer-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Type" htmlFor="customer-type">
              <SelectInput
                id="customer-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as CustomerType })}
              >
                {Object.entries(customerTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone" htmlFor="customer-phone">
                <TextInput
                  id="customer-phone"
                  value={form.phone ?? ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor="customer-email">
                <TextInput
                  id="customer-email"
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Address" htmlFor="customer-address">
              <TextInput
                id="customer-address"
                value={form.address ?? ''}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="Notes" htmlFor="customer-notes">
              <TextArea
                id="customer-notes"
                rows={2}
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <FormError message={formError} />
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmDialog
          title={statusTarget.status === 'ACTIVE' ? 'Deactivate customer' : 'Activate customer'}
          message={
            statusTarget.status === 'ACTIVE'
              ? `Deactivate "${statusTarget.name}"? Customers with an outstanding credit balance cannot be deactivated.`
              : `Reactivate "${statusTarget.name}"?`
          }
          busy={toggling}
          onConfirm={() => void toggleStatus()}
          onCancel={() => setStatusTarget(null)}
        />
      )}
    </div>
  );
}
