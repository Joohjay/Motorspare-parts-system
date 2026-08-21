import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  EmptyState,
  Field,
  FormError,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { expensesApi } from '@/lib/financeApi';
import { formatCurrency } from '@/lib/inventoryApi';
import type { Expense, ExpenseCategory } from '@/types/api';

export function ExpensesPage(): ReactElement {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [listError, setListError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const load = useCallback(async (page = 1) => {
    setListError(null);
    try {
      const [categoryResult, expensePage] = await Promise.all([
        expensesApi.listCategories(),
        expensesApi.list({ page, pageSize: 10 }),
      ]);
      setCategories(categoryResult.items);
      setExpenses(expensePage.items);
      setPagination({ page: expensePage.pagination.page, totalPages: expensePage.pagination.totalPages });
    } catch (err) {
      setListError(errorMessage(err, 'Could not load expenses'));
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  const submit = async (): Promise<void> => {
    if (!categoryId || !amount || Number(amount) <= 0) {
      setFormError('Choose a category and enter a positive amount');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await expensesApi.create({
        categoryId,
        amount: Number(amount),
        description: description.trim() || null,
        reference: reference.trim() || null,
      });
      setCreating(false);
      setAmount('');
      setDescription('');
      setReference('');
      await load(pagination.page);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not record the expense'));
    } finally {
      setBusy(false);
    }
  };

  const voidExpense = async (): Promise<void> => {
    if (!voidTarget) return;
    setBusy(true);
    try {
      await expensesApi.void(voidTarget.id);
      setVoidTarget(null);
      await load(pagination.page);
    } catch (err) {
      setListError(errorMessage(err, 'Could not void the expense'));
      setVoidTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async (): Promise<void> => {
    if (!newCategoryName.trim()) return;
    setCategoryError(null);
    try {
      await expensesApi.createCategory({ name: newCategoryName.trim() });
      setNewCategoryName('');
      const result = await expensesApi.listCategories();
      setCategories(result.items);
    } catch (err) {
      setCategoryError(errorMessage(err, 'Could not create the category'));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Expenses</h1>
          <p className="text-sm text-slate-500">Operating costs recorded against categories.</p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setCategoryId(categories[0]?.id ?? '');
              setFormError(null);
              setCreating(true);
            }}
          >
            Record expense
          </Button>
        )}
      </div>

      <FormError message={listError} />

      {isAdmin && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void addCategory();
          }}
        >
          <Field label="New category" htmlFor="new-category">
            <TextInput
              id="new-category"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
          </Field>
          <Button variant="secondary" type="submit">
            Add category
          </Button>
          <FormError message={categoryError} />
        </form>
      )}

      {expenses === null ? (
        <LoadingState />
      ) : expenses.length === 0 ? (
        <EmptyState message="No expenses recorded." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{new Date(expense.expenseDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{expense.categoryName}</td>
                  <td className="px-4 py-3">{expense.description ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(expense.amount)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        expense.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-red-50 text-red-700 ring-red-200'
                      }`}
                    >
                      {expense.status === 'ACTIVE' ? 'Active' : 'Voided'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      {expense.status === 'ACTIVE' && (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => setVoidTarget(expense)}
                        >
                          Void
                        </button>
                      )}
                    </td>
                  )}
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

      {creating && (
        <Modal title="Record expense" onClose={() => setCreating(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Category" htmlFor="expense-category" required>
              <SelectInput
                id="expense-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Select…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Amount" htmlFor="expense-amount" required>
              <TextInput
                id="expense-amount"
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Description" htmlFor="expense-description">
              <TextInput
                id="expense-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Reference" htmlFor="expense-reference">
              <TextInput
                id="expense-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <FormError message={formError} />
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {voidTarget && (
        <ConfirmDialog
          title="Void expense"
          message={`Void "${voidTarget.description || voidTarget.categoryName}" for ${formatCurrency(voidTarget.amount)}? Voided expenses are kept for audit but excluded from reports.`}
          busy={busy}
          onConfirm={() => void voidExpense()}
          onCancel={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
