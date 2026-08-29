import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  ErrorState,
  Field,
  FormError,
  LoadingState,
  SelectInput,
  TextArea,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { ApiClientError } from '@/lib/api';
import { productsApi } from '@/lib/catalogApi';
import type { CatalogStatus } from '@/types/api';

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const navigate = useNavigate();

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [minimumStock, setMinimumStock] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('0');
  const [quantityOnHand, setQuantityOnHand] = useState('0');
  const [status, setStatus] = useState<CatalogStatus>('ACTIVE');

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    if (!isEdit) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    void productsApi
      .get(id as string)
      .then(({ product }) => {
        if (!active) return;
        setSku(product.sku);
        setName(product.name);
        setDescription(product.description ?? '');
        setCostPrice(String(Number(product.costPrice)));
        setRetailPrice(String(Number(product.retailPrice)));
        setWholesalePrice(String(Number(product.wholesalePrice)));
        setMinimumStock(String(product.minimumStock));
        setReorderLevel(String(product.reorderLevel));
        setStatus(product.status);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(errorMessage(err, 'Unable to load product data. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isEdit, id]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const cost = Number(costPrice);
    const retail = Number(retailPrice);
    const wholesale = Number(wholesalePrice);
    const minStock = Number(minimumStock);
    const reorder = Number(reorderLevel);
    if (!Number.isFinite(cost) || cost < 0) {
      setError('Cost price must be a number of at least 0.');
      setSubmitting(false);
      return;
    }
    if (!Number.isFinite(retail) || retail < 0) {
      setError('Retail price must be a number of at least 0.');
      setSubmitting(false);
      return;
    }
    if (!Number.isFinite(wholesale) || wholesale < 0) {
      setError('Wholesale price must be a number of at least 0.');
      setSubmitting(false);
      return;
    }

    try {
      if (isEdit) {
        await productsApi.update(id as string, {
          sku: sku.trim(),
          name: name.trim(),
          description: description.trim() || null,
          costPrice: cost,
          retailPrice: retail,
          wholesalePrice: wholesale,
          minimumStock: minStock,
          reorderLevel: reorder,
          status,
        });
      } else {
        const qty = Number(quantityOnHand);
        if (!Number.isInteger(qty) || qty < 0) {
          setError('Initial quantity on hand must be a whole number of 0 or more.');
          setSubmitting(false);
          return;
        }
        await productsApi.create({
          sku: sku.trim(),
          name: name.trim(),
          description: description.trim() || null,
          costPrice: cost,
          retailPrice: retail,
          wholesalePrice: wholesale,
          minimumStock: minStock,
          reorderLevel: reorder,
          quantityOnHand: qty,
        });
      }
      navigate('/catalog/products');
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : `Unable to ${isEdit ? 'update' : 'create'} the product. Please try again.`;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading product…" />;
  if (loadError) return <ErrorState message={loadError} />;

  const cost = Number(costPrice);
  const retail = Number(retailPrice);
  const wholesale = Number(wholesalePrice);
  const retailProfit = Number.isFinite(cost) && Number.isFinite(retail) ? retail - cost : null;
  const wholesaleProfit =
    Number.isFinite(cost) && Number.isFinite(wholesale) ? wholesale - cost : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isEdit ? 'Edit product' : 'New product'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Core details and pricing for {isEdit ? 'this' : 'the new'} product.
          </p>
        </div>
        <Link to="/catalog/products" className="text-sm text-slate-500 hover:text-slate-700">
          Back to products
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Product details
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="SKU" htmlFor="product-sku" required>
              <TextInput
                id="product-sku"
                required
                maxLength={64}
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </Field>
            <Field label="Name" htmlFor="product-name" required>
              <TextInput
                id="product-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description" htmlFor="product-description">
                <TextArea
                  id="product-description"
                  rows={3}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Minimum stock" htmlFor="product-minstock">
              <TextInput
                id="product-minstock"
                type="number"
                min={0}
                step={1}
                value={minimumStock}
                onChange={(e) => setMinimumStock(e.target.value)}
              />
            </Field>
            <Field label="Reorder level" htmlFor="product-reorder">
              <TextInput
                id="product-reorder"
                type="number"
                min={0}
                step={1}
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
              />
            </Field>
            {!isEdit && (
              <Field
                label="Initial quantity on hand"
                htmlFor="product-qty"
                hint="Optional — how many units are already in stock. Leave 0 if none."
              >
                <TextInput
                  id="product-qty"
                  type="number"
                  min={0}
                  step={1}
                  value={quantityOnHand}
                  onChange={(e) => setQuantityOnHand(e.target.value)}
                />
              </Field>
            )}
            {isEdit && (
              <Field label="Status" htmlFor="product-status">
                <SelectInput
                  id="product-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CatalogStatus)}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </SelectInput>
              </Field>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pricing
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Cost price is what you buy the product for; profit is the selling price minus cost.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Cost price (TZS)" htmlFor="product-cost" required>
              <TextInput
                id="product-cost"
                type="number"
                min={0}
                step="0.01"
                required
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </Field>
            <Field label="Retail price (TZS)" htmlFor="product-retail" required>
              <TextInput
                id="product-retail"
                type="number"
                min={0}
                step="0.01"
                required
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
              />
            </Field>
            <Field label="Wholesale price (TZS)" htmlFor="product-wholesale" required>
              <TextInput
                id="product-wholesale"
                type="number"
                min={0}
                step="0.01"
                required
                value={wholesalePrice}
                onChange={(e) => setWholesalePrice(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {retailProfit !== null && (
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-600">
                Retail profit:{' '}
                <strong
                  className={retailProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                >
                  {(retailProfit >= 0 ? '' : '-') +
                    `TZS ${Math.abs(retailProfit).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </strong>
              </span>
            )}
            {wholesaleProfit !== null && (
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-600">
                Wholesale profit:{' '}
                <strong
                  className={wholesaleProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                >
                  {(wholesaleProfit >= 0 ? '' : '-') +
                    `TZS ${Math.abs(wholesaleProfit).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </strong>
              </span>
            )}
          </div>
        </Card>

        <FormError message={error} />

        <div className="flex justify-end gap-3">
          <Link to="/catalog/products">
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>
    </div>
  );
}