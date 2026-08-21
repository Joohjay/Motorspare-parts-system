import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiClientError } from '@/lib/api';
import { brandsApi, categoriesApi, formatPrice, productsApi } from '@/lib/catalogApi';
import type { Brand, Category, ProductListItem } from '@/types/api';

type TargetAction = { product: ProductListItem; status: 'ACTIVE' | 'INACTIVE' } | null;

export function ProductsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [target, setTarget] = useState<TargetAction>(null);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    productsApi
      .list({
        q: q || undefined,
        status: (status as 'ACTIVE' | 'INACTIVE') || undefined,
        categoryId: categoryId || undefined,
        brandId: brandId || undefined,
        page,
        pageSize,
        sortBy: 'name',
        sortOrder: 'asc',
      })
      .then((data) => {
        if (!active) return;
        setProducts(data.items);
        setTotalPages(data.pagination.totalPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load products. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, status, categoryId, brandId, page, pageSize, reloadTick]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      categoriesApi.list({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
      brandsApi.list({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
    ])
      .then(([catData, brandData]) => {
        if (!active) return;
        setCategories(catData.items);
        setBrands(brandData.items);
      })
      .catch(() => {
        // Filter options are non-critical; the list still renders.
      });
    return () => {
      active = false;
    };
  }, []);

  async function confirmToggle() {
    if (!target) return;
    setMutating(true);
    try {
      await productsApi.setStatus(target.product.id, target.status);
      setTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update product status. Please try again.';
      setError(message);
    } finally {
      setMutating(false);
    }
  }

  function handleSearch(value: string) {
    setQ(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage the spare parts catalog, identifiers, and motorcycle compatibility.
          </p>
        </div>
        {isAdmin && (
          <Link to="/catalog/products/new">
            <Button>New product</Button>
          </Link>
        )}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="product-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <TextInput
              id="product-search"
              placeholder="Name, SKU, identifier, brand…"
              value={q}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="product-status" className="block text-sm font-medium text-slate-700">
              Status
            </label>
            <SelectInput
              id="product-status"
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
          <div>
            <label htmlFor="product-category" className="block text-sm font-medium text-slate-700">
              Category
            </label>
            <SelectInput
              id="product-category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </div>
          <div>
            <label htmlFor="product-brand" className="block text-sm font-medium text-slate-700">
              Brand
            </label>
            <SelectInput
              id="product-brand"
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading products…" />
      ) : !products || products.length === 0 ? (
        <EmptyState message="No products match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 text-right font-medium">Retail</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-center font-medium">Compat.</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{product.sku}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={isAdmin ? `/catalog/products/${product.id}/edit` : '/catalog/products'}
                        className="font-medium text-slate-900 hover:text-brand-600"
                      >
                        {product.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{product.category?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{product.brand?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatPrice(product.retailPrice)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={product.status} />
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {product.compatibilityCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setTarget({
                              product,
                              status: product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                            })
                          }
                        >
                          {product.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </Button>
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

      {target && (
        <ConfirmDialog
          title={target.status === 'INACTIVE' ? 'Deactivate product' : 'Activate product'}
          message={`${target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'} "${target.product.name}"? Inactive products are hidden from quick selection.`}
          confirmLabel={target.status === 'INACTIVE' ? 'Deactivate' : 'Activate'}
          busy={mutating}
          onConfirm={() => void confirmToggle()}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}