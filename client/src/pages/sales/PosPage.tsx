import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import {
  EmptyState,
  Field,
  FormError,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { ApiClientError } from '@/lib/api';
import { formatCurrency, inventoryApi } from '@/lib/inventoryApi';
import { productsApi } from '@/lib/catalogApi';
import { printingApi } from '@/lib/printingApi';
import { salesApi } from '@/lib/salesApi';
import type { PaymentMethod, Sale } from '@/types/api';
import type { InventoryListItem } from '@/types/api';

interface CartLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  available: number;
}

interface PaymentRow {
  paymentMethod: PaymentMethod;
  amount: string;
  reference: string;
}

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];

const money = (value: number): string => value.toFixed(2);

const PRODUCT_PAGE_SIZE = 24;

export function PosPage(): ReactElement {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InventoryListItem[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, { retail: number; wholesale: number }>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleType, setSaleType] = useState<'RETAIL' | 'WHOLESALE'>('RETAIL');
  const [notes, setNotes] = useState('');

  const [payments, setPayments] = useState<PaymentRow[]>([
    { paymentMethod: 'CASH', amount: '', reference: '' },
  ]);

  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [cart],
  );

  const allocated = useMemo(
    () => payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [payments],
  );
  const remaining = Math.round((subtotal - allocated) * 100) / 100;

  const loadProducts = useCallback(async (searchQuery: string, pageNumber: number) => {
    setSearching(true);
    setSearchError(null);
    try {
      const [inventoryPage, productPage] = await Promise.all([
        inventoryApi.list({ q: searchQuery || undefined, page: pageNumber, pageSize: PRODUCT_PAGE_SIZE }),
        productsApi.list({ q: searchQuery || undefined, page: pageNumber, pageSize: PRODUCT_PAGE_SIZE, status: 'ACTIVE' }),
      ]);
      setResults(inventoryPage.items);
      setTotalPages(inventoryPage.pagination.totalPages);
      const prices: Record<string, { retail: number; wholesale: number }> = {};
      for (const product of productPage.items) {
        prices[product.sku] = {
          retail: Number(product.retailPrice),
          wholesale: Number(product.wholesalePrice),
        };
      }
      setPriceMap(prices);
    } catch (err) {
      setSearchError(errorMessage(err, 'Could not load products'));
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts(query, page);
  }, [loadProducts, query, page]);

  const addToCart = (item: InventoryListItem): void => {
    void (async () => {
      const knownPrice = priceMap[item.sku];
      let defaultPrice =
        knownPrice !== undefined
          ? saleType === 'WHOLESALE'
            ? knownPrice.wholesale
            : knownPrice.retail
          : 0;
      if (!defaultPrice) {
        try {
          const { product } = await productsApi.get(item.productId);
          defaultPrice = Number(saleType === 'WHOLESALE' ? product.wholesalePrice : product.retailPrice);
        } catch {
          defaultPrice = 0;
        }
      }
      setCart((current) => {
        const existing = current.find((line) => line.productId === item.productId);
        if (existing) {
          return current.map((line) =>
            line.productId === item.productId
              ? { ...line, quantity: Math.min(line.quantity + 1, item.available) }
              : line,
          );
        }
        return [
          ...current,
          {
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            quantity: 1,
            unitPrice: Number.isFinite(defaultPrice) && defaultPrice > 0 ? defaultPrice : 0,
            available: item.available,
          },
        ];
      });
    })();
  };

  const updateLine = (productId: string, patch: Partial<CartLine>): void => {
    setCart((current) =>
      current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (productId: string): void => {
    setCart((current) => current.filter((line) => line.productId !== productId));
  };

  const updatePayment = (index: number, patch: Partial<PaymentRow>): void => {
    setPayments((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const canSubmit = cart.length > 0 && remaining === 0 && allocated > 0;

  const sendToPrinter = async (saleId: string): Promise<void> => {
    setPrinting(true);
    setPrintStatus(null);
    try {
      const result = await printingApi.printReceipt(saleId);
      setPrintStatus(result.printed ? `Receipt sent to ${result.printer}.` : 'Receipt was not printed.');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'PRINTING_NOT_CONFIGURED') {
        setPrintStatus('No receipt printer configured — open Settings to choose one.');
      } else {
        setPrintStatus(`Auto-print failed: ${errorMessage(err, 'Could not print receipt')}`);
      }
    } finally {
      setPrinting(false);
    }
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await salesApi.create({
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: isAdmin ? line.unitPrice : undefined,
        })),
        payments: payments.map((row) => ({
          paymentMethod: row.paymentMethod,
          amount: Number(row.amount),
          reference: row.reference.trim() || undefined,
        })),
        saleType,
        notes: notes.trim() || null,
      });
      setCompletedSale(result.sale);
      setConfirming(false);
      setCart([]);
      setPayments([{ paymentMethod: 'CASH', amount: '', reference: '' }]);
      setNotes('');
      void sendToPrinter(result.sale.id);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Could not record the sale'));
    } finally {
      setSubmitting(false);
    }
  };

  if (completedSale) {
    return (
      <div className="mx-auto max-w-xl space-y-6 p-6 text-center">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Sale completed!</h1>
          <p className="mt-1 text-sm text-slate-600">
            {completedSale.saleNumber} &mdash; {formatCurrency(completedSale.totalAmount)}
          </p>
        </div>
        {printStatus ? (
          <p className={`text-sm ${printStatus.startsWith('Receipt sent') ? 'text-emerald-700' : 'text-amber-700'}`}>
            {printStatus}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => void sendToPrinter(completedSale.id)}
            disabled={printing}
          >
            {printing ? <Spinner /> : 'Print receipt'}
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/sales/${completedSale.id}`)}>
            View sale details
          </Button>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => navigate(`/sales/${completedSale.id}/receipt`)}
        >
          Open receipt in browser print…
        </button>
        <button
          type="button"
          className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => setCompletedSale(null)}
        >
          Start a new sale
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Point of sale</h1>
          <p className="text-sm text-slate-500">Search stock, build the basket and take payment.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Product search */}
        <section className="space-y-3 lg:col-span-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(search);
            }}
          >
            <TextInput
              placeholder="Search by SKU or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="secondary" type="submit" disabled={searching}>
              {searching ? <Spinner /> : 'Search'}
            </Button>
          </form>
          <FormError message={searchError} />
          {results.length === 0 ? (
            <EmptyState message="No products found. Try a different search." />
          ) : (
            <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {results.map((item) => {
                const price = priceMap[item.sku];
                const displayPrice =
                  price !== undefined
                    ? saleType === 'WHOLESALE'
                      ? price.wholesale
                      : price.retail
                    : null;
                return (
                  <li
                    key={item.productId}
                    className="flex flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div>
                      <p className="font-medium leading-tight text-slate-800">{item.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {item.sku}
                        {item.brandName ? ` · ${item.brandName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="text-slate-500">Available </span>
                        <span
                          className={
                            item.available <= 0
                              ? 'font-semibold text-red-600'
                              : 'font-semibold text-slate-800'
                          }
                        >
                          {item.available}
                        </span>
                        {displayPrice !== null && (
                          <p className="text-xs text-slate-500">{formatCurrency(displayPrice)}</p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5"
                        disabled={item.available <= 0}
                        onClick={() => addToCart(item)}
                      >
                        Add
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <PaginationControls
            page={page}
            totalPages={totalPages}
            onPageChange={(next) => setPage(next)}
          />

          {/* Cart */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {cart.length === 0 ? (
              <EmptyState message="Basket is empty." />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 w-24">Qty</th>
                    <th className="px-3 py-2 w-32">Unit price</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((line) => (
                    <tr key={line.productId} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-800">{line.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{line.sku}</span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          max={line.available}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.productId, {
                              quantity: Math.max(1, Math.min(Number(e.target.value) || 1, line.available)),
                            })
                          }
                          className="w-20 rounded-md border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          disabled={!isAdmin}
                          title={isAdmin ? undefined : 'Only an administrator can override prices'}
                          onChange={(e) =>
                            updateLine(line.productId, { unitPrice: Number(e.target.value) || 0 })
                          }
                          className="w-28 rounded-md border border-slate-300 px-2 py-1 disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatCurrency(money(line.quantity * line.unitPrice))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => removeLine(line.productId)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Checkout panel */}
        <section className="space-y-4 lg:col-span-2">
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <Field label="Sale type" htmlFor="sale-type">
              <SelectInput
                id="sale-type"
                value={saleType}
                onChange={(e) => setSaleType(e.target.value as 'RETAIL' | 'WHOLESALE')}
              >
                <option value="RETAIL">Retail</option>
                <option value="WHOLESALE">Wholesale</option>
              </SelectInput>
            </Field>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">Total due</span>
              <span className="text-lg font-semibold text-slate-900">{formatCurrency(money(subtotal))}</span>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-700">Payment allocation</p>
            {payments.map((row, index) => (
              <div key={index} className="space-y-2 rounded-md border border-slate-100 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <SelectInput
                    aria-label="Payment method"
                    value={row.paymentMethod}
                    onChange={(e) => updatePayment(index, { paymentMethod: e.target.value as PaymentMethod })}
                  >
                    {PAYMENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </SelectInput>
                  <div className="flex gap-2">
                    <TextInput
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Amount"
                      value={row.amount}
                      onChange={(e) => updatePayment(index, { amount: e.target.value })}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 px-2.5"
                      disabled={remaining <= 0}
                      title={remaining <= 0 ? 'Nothing left to pay' : 'Pay the full remaining amount'}
                      onClick={() => updatePayment(index, { amount: money(remaining) })}
                    >
                      Exact
                    </Button>
                  </div>
                </div>
                {['MPESA', 'BANK', 'CHEQUE'].includes(row.paymentMethod) && (
                  <TextInput
                    placeholder="Transaction reference"
                    value={row.reference}
                    onChange={(e) => updatePayment(index, { reference: e.target.value })}
                  />
                )}
                {payments.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove payment
                  </button>
                )}
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setPayments((current) => [...current, { paymentMethod: 'CASH', amount: '', reference: '' }])
              }
            >
              Add split payment
            </Button>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">Remaining</span>
              <span className={remaining === 0 ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
                {formatCurrency(money(remaining))}
              </span>
            </div>
          </div>

          <Button className="w-full" disabled={!canSubmit} onClick={() => setConfirming(true)}>
            Complete sale
          </Button>
        </section>
      </div>

      {confirming && (
        <Modal title="Confirm sale" onClose={() => setConfirming(false)}>
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              {cart.length} line(s), total{' '}
              <strong className="text-slate-900">{formatCurrency(money(subtotal))}</strong>.
            </p>
            <ul className="list-disc pl-5">
              {payments.map((row, i) => (
                <li key={i}>
                  {row.paymentMethod}: {formatCurrency(row.amount || '0')}
                </li>
              ))}
            </ul>
            <FormError message={submitError} />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
              Back
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Spinner /> : 'Record sale'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
