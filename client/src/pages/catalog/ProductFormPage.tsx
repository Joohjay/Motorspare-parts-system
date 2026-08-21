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
import {
  brandsApi,
  categoriesApi,
  identifierTypes,
  motorcyclesApi,
  productsApi,
} from '@/lib/catalogApi';
import type {
  Brand,
  Category,
  CatalogStatus,
  IdentifierInput,
  IdentifierType,
  MotorcycleMake,
  MotorcycleModel,
  MotorcycleVariant,
  ProductDetail,
} from '@/types/api';

interface CompatibilityRow {
  variantId: string;
  label: string;
  notes: string;
}

function buildLabel(variant: MotorcycleVariant): string {
  return `${variant.model.make.name} ${variant.model.name} ${variant.name}`.trim();
}

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const navigate = useNavigate();

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [minimumStock, setMinimumStock] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('0');
  const [status, setStatus] = useState<CatalogStatus>('ACTIVE');

  const [identifiers, setIdentifiers] = useState<IdentifierInput[]>([
    { type: 'PART_NUMBER', value: '' },
  ]);
  const [compatibilities, setCompatibilities] = useState<CompatibilityRow[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [makes, setMakes] = useState<MotorcycleMake[]>([]);

  const [makeId, setMakeId] = useState('');
  const [modelId, setModelId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [models, setModels] = useState<MotorcycleModel[]>([]);
  const [variants, setVariants] = useState<MotorcycleVariant[]>([]);

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    const tasks: Promise<unknown>[] = [
      categoriesApi.list({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
      brandsApi.list({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
      motorcyclesApi.listMakes({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
    ];
    if (isEdit) {
      tasks.push(productsApi.get(id as string));
    }
    void Promise.all(tasks)
      .then((results) => {
        if (!active) return;
        const catData = results[0] as { items: Category[] };
        const brandData = results[1] as { items: Brand[] };
        const makeData = results[2] as { items: MotorcycleMake[] };
        setCategories(catData.items);
        setBrands(brandData.items);
        setMakes(makeData.items);
        if (isEdit) {
          const product = (results[3] as { product: ProductDetail }).product;
          setSku(product.sku);
          setName(product.name);
          setDescription(product.description ?? '');
          setCategoryId(product.categoryId);
          setBrandId(product.brandId ?? '');
          setRetailPrice(String(Number(product.retailPrice)));
          setWholesalePrice(String(Number(product.wholesalePrice)));
          setMinimumStock(String(product.minimumStock));
          setReorderLevel(String(product.reorderLevel));
          setStatus(product.status);
          setIdentifiers(
            product.identifiers.length > 0
              ? product.identifiers.map((identifier) => ({
                  type: identifier.type as IdentifierType,
                  value: identifier.value,
                }))
              : [{ type: 'PART_NUMBER', value: '' }],
          );
          setCompatibilities(
            product.compatibilities.map((entry) => ({
              variantId: entry.variant.id,
              label: `${entry.variant.model.make.name} ${entry.variant.model.name} ${entry.variant.name}`.trim(),
              notes: entry.notes ?? '',
            })),
          );
        }
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

  useEffect(() => {
    if (!makeId) {
      setModels([]);
      setModelId('');
      return;
    }
    let active = true;
    motorcyclesApi
      .listModels({ makeId, pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (active) {
          setModels(data.items);
          setModelId('');
          setVariants([]);
          setVariantId('');
        }
      })
      .catch(() => {
        if (active) {
          setModels([]);
          setModelId('');
        }
      });
    return () => {
      active = false;
    };
  }, [makeId]);

  useEffect(() => {
    if (!modelId) {
      setVariants([]);
      setVariantId('');
      return;
    }
    let active = true;
    motorcyclesApi
      .listVariants({ modelId, pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (active) {
          setVariants(data.items);
          setVariantId('');
        }
      })
      .catch(() => {
        if (active) {
          setVariants([]);
          setVariantId('');
        }
      });
    return () => {
      active = false;
    };
  }, [modelId]);

  function addIdentifierRow() {
    setIdentifiers((rows) => [...rows, { type: 'PART_NUMBER', value: '' }]);
  }

  function updateIdentifier(index: number, patch: Partial<IdentifierInput>) {
    setIdentifiers((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeIdentifier(index: number) {
    setIdentifiers((rows) => rows.filter((_, i) => i !== index));
  }

  function addCompatibilityRow() {
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) return;
    if (compatibilities.some((row) => row.variantId === variantId)) {
      setError('That motorcycle variant is already in the compatibility list.');
      return;
    }
    setCompatibilities((rows) => [...rows, { variantId, label: buildLabel(variant), notes: '' }]);
    setVariantId('');
  }

  function updateCompatibilityNotes(index: number, notes: string) {
    setCompatibilities((rows) => rows.map((row, i) => (i === index ? { ...row, notes } : row)));
  }

  function removeCompatibilityRow(index: number) {
    setCompatibilities((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const retail = Number(retailPrice);
    const wholesale = Number(wholesalePrice);
    const minStock = Number(minimumStock);
    const reorder = Number(reorderLevel);
    if (!categoryId) {
      setError('Please choose a category.');
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

    const payloadIdentifiers = identifiers.filter(
      (row) => row.type && row.value.trim().length > 0,
    );
    const payloadCompatibility = compatibilities.map((row) => ({
      variantId: row.variantId,
      notes: row.notes.trim() || null,
    }));

    try {
      if (isEdit) {
        await productsApi.update(id as string, {
          sku: sku.trim(),
          name: name.trim(),
          description: description.trim() || null,
          categoryId,
          brandId: brandId || null,
          retailPrice: retail,
          wholesalePrice: wholesale,
          minimumStock: minStock,
          reorderLevel: reorder,
          status,
          identifiers: payloadIdentifiers,
          compatibility: payloadCompatibility,
        });
      } else {
        await productsApi.create({
          sku: sku.trim(),
          name: name.trim(),
          description: description.trim() || null,
          categoryId,
          brandId: brandId || null,
          retailPrice: retail,
          wholesalePrice: wholesale,
          minimumStock: minStock,
          reorderLevel: reorder,
          identifiers: payloadIdentifiers,
          compatibility: payloadCompatibility,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isEdit ? 'Edit product' : 'New product'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Core details, reference identifiers, and motorcycle compatibility.
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
            <Field label="Category" htmlFor="product-category" required>
              <SelectInput
                id="product-category"
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Choose a category…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Brand" htmlFor="product-brand" hint="Optional.">
              <SelectInput
                id="product-brand"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
              >
                <option value="">No brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Retail price (KSh)" htmlFor="product-retail" required>
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
            <Field label="Wholesale price (KSh)" htmlFor="product-wholesale" required>
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Reference identifiers
            </h2>
            <Button variant="secondary" onClick={addIdentifierRow}>
              Add identifier
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Alternate part, OEM, supplier, or barcode numbers used to find this product.
          </p>
          <div className="mt-4 space-y-3">
            {identifiers.map((row, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="w-48">
                  <label
                    htmlFor={`identifier-type-${index}`}
                    className="sr-only"
                  >
                    Type
                  </label>
                  <SelectInput
                    id={`identifier-type-${index}`}
                    value={row.type}
                    onChange={(e) =>
                      updateIdentifier(index, { type: e.target.value as IdentifierType })
                    }
                  >
                    {identifierTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </SelectInput>
                </div>
                <div className="flex-1">
                  <label htmlFor={`identifier-value-${index}`} className="sr-only">
                    Value
                  </label>
                  <TextInput
                    id={`identifier-value-${index}`}
                    maxLength={128}
                    placeholder="Identifier value"
                    value={row.value}
                    onChange={(e) => updateIdentifier(index, { value: e.target.value })}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() => removeIdentifier(index)}
                  disabled={identifiers.length === 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Motorcycle compatibility
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            The motorcycle variants this product fits. Use the cascading selectors to add one.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Field label="Make" htmlFor="compat-make">
              <SelectInput
                id="compat-make"
                value={makeId}
                onChange={(e) => setMakeId(e.target.value)}
              >
                <option value="">All makes…</option>
                {makes.map((make) => (
                  <option key={make.id} value={make.id}>
                    {make.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Model" htmlFor="compat-model">
              <SelectInput
                id="compat-model"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!makeId}
              >
                <option value="">All models…</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Variant" htmlFor="compat-variant">
              <SelectInput
                id="compat-variant"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                disabled={!modelId}
              >
                <option value="">All variants…</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name}
                    {variant.yearFrom ? ` (${variant.yearFrom}–${variant.yearTo ?? 'now'})` : ''}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="flex items-end">
              <Button onClick={addCompatibilityRow} disabled={!variantId}>
                Add fitment
              </Button>
            </div>
          </div>

          {compatibilities.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {compatibilities.map((row, index) => (
                <li key={row.variantId} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1 text-sm font-medium text-slate-900">{row.label}</span>
                  <div className="w-56">
                    <label htmlFor={`compat-notes-${index}`} className="sr-only">
                      Notes
                    </label>
                    <TextInput
                      id={`compat-notes-${index}`}
                      maxLength={500}
                      placeholder="Notes (optional)"
                      value={row.notes}
                      onChange={(e) => updateCompatibilityNotes(index, e.target.value)}
                    />
                  </div>
                  <Button variant="ghost" onClick={() => removeCompatibilityRow(index)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              No compatibility links yet.
            </p>
          )}
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