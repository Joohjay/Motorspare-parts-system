import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { StockStatusPill } from '@/components/ui/StockStatusPill';
import { brandsApi, motorcyclesApi } from '@/lib/catalogApi';
import { formatCurrency, formatQuantity, inventoryApi } from '@/lib/inventoryApi';
import type {
  Brand,
  InventoryListItem,
  MotorcycleMake,
  MotorcycleModel,
  MotorcycleVariant,
  StockStatus,
} from '@/types/api';

const PAGE_SIZE = 20;

const SORTABLE = new Set([
  'name',
  'sku',
  'quantityOnHand',
  'available',
  'weightedAverageCost',
  'inventoryValue',
  'updatedAt',
]);

type SortField =
  | 'name'
  | 'sku'
  | 'quantityOnHand'
  | 'available'
  | 'weightedAverageCost'
  | 'inventoryValue'
  | 'updatedAt';

function SortHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  className = '',
}: {
  label: string;
  field: SortField;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const active = sortBy === field;
  const next = active && sortOrder === 'asc' ? 'desc' : 'asc';
  return (
    <th className={`px-4 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={`Sort by ${label} ${next === 'asc' ? 'ascending' : 'descending'}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900 ${
          active ? 'text-slate-900' : ''
        }`}
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {active ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

type StockFilter = '' | StockStatus;

export function InventoryPage() {
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('');
  const [brandId, setBrandId] = useState('');
  const [makeId, setMakeId] = useState('');
  const [modelId, setModelId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<InventoryListItem[] | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [makes, setMakes] = useState<MotorcycleMake[]>([]);
  const [models, setModels] = useState<MotorcycleModel[]>([]);
  const [variants, setVariants] = useState<MotorcycleVariant[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    inventoryApi
      .list({
        q: q || undefined,
        stockStatus: stockFilter || undefined,
        brandId: brandId || undefined,
        makeId: makeId || undefined,
        modelId: modelId || undefined,
        variantId: variantId || undefined,
        sortBy: sortBy || undefined,
        sortOrder,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotalPages(data.pagination.totalPages);
        setTotalItems(data.pagination.totalItems);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err, 'Unable to load inventory. Please try again.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, stockFilter, brandId, makeId, modelId, variantId, sortBy, sortOrder, page]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      brandsApi.list({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
      motorcyclesApi.listMakes({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
    ])
      .then(([brandData, makeData]) => {
        if (!active) return;
        setBrands(brandData.items);
        setMakes(makeData.items);
      })
      .catch(() => {
        // Filter options are non-critical; the list still renders.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!makeId) {
      setModels([]);
      setVariants([]);
      return;
    }
    motorcyclesApi
      .listModels({ makeId, pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (!active) return;
        setModels(data.items);
      })
      .catch(() => {
        setModels([]);
      });
    return () => {
      active = false;
    };
  }, [makeId]);

  useEffect(() => {
    let active = true;
    if (!modelId) {
      setVariants([]);
      return;
    }
    motorcyclesApi
      .listVariants({ modelId, pageSize: 500, sortBy: 'name', sortOrder: 'asc' })
      .then((data) => {
        if (!active) return;
        setVariants(data.items);
      })
      .catch(() => {
        setVariants([]);
      });
    return () => {
      active = false;
    };
  }, [modelId]);

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  function resetPage() {
    setPage(1);
  }

  const lowStockCount = useMemo(() => {
    if (stockFilter) return null;
    return items?.filter((i) => i.status === 'LOW_STOCK' || i.status === 'OUT_OF_STOCK').length ?? null;
  }, [items, stockFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock levels, weighted-average cost, and movement history for every part.
          </p>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="inventory-search" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <TextInput
              id="inventory-search"
              placeholder="Name, SKU, identifier, brand, category…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPage();
              }}
            />
          </div>
          <div>
            <label htmlFor="inventory-stock" className="block text-sm font-medium text-slate-700">
              Stock status
            </label>
            <SelectInput
              id="inventory-stock"
              value={stockFilter}
              onChange={(e) => {
                setStockFilter(e.target.value as StockFilter);
                resetPage();
              }}
            >
              <option value="">All stock</option>
              <option value="HEALTHY">Healthy</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="OUT_OF_STOCK">Out of stock</option>
            </SelectInput>
          </div>
          <div>
            <label htmlFor="inventory-brand" className="block text-sm font-medium text-slate-700">
              Brand
            </label>
            <SelectInput
              id="inventory-brand"
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                resetPage();
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
          <div>
            <label htmlFor="inventory-make" className="block text-sm font-medium text-slate-700">
              Motorcycle make
            </label>
            <SelectInput
              id="inventory-make"
              value={makeId}
              onChange={(e) => {
                setMakeId(e.target.value);
                setModelId('');
                setVariantId('');
                resetPage();
              }}
            >
              <option value="">All makes</option>
              {makes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </SelectInput>
          </div>
          <div>
            <label htmlFor="inventory-model" className="block text-sm font-medium text-slate-700">
              Model
            </label>
            <SelectInput
              id="inventory-model"
              value={modelId}
              disabled={!makeId}
              onChange={(e) => {
                setModelId(e.target.value);
                setVariantId('');
                resetPage();
              }}
            >
              <option value="">All models</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </SelectInput>
          </div>
          <div>
            <label htmlFor="inventory-variant" className="block text-sm font-medium text-slate-700">
              Variant
            </label>
            <SelectInput
              id="inventory-variant"
              value={variantId}
              disabled={!modelId}
              onChange={(e) => {
                setVariantId(e.target.value);
                resetPage();
              }}
            >
              <option value="">All variants</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>
      </Card>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading inventory…" />
      ) : !items || items.length === 0 ? (
        <EmptyState message="No inventory records match your filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
            <span>
              {totalItems} item{totalItems === 1 ? '' : 's'}
            </span>
            {lowStockCount !== null && lowStockCount > 0 && (
              <span className="font-medium text-amber-700">
                {lowStockCount} low or out of stock on this page
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <SortHeader label="Product" field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  <SortHeader label="SKU" field="sku" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <SortHeader label="On hand" field="quantityOnHand" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortHeader label="Available" field="available" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortHeader label="Avg cost" field="weightedAverageCost" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortHeader label="Value" field="inventoryValue" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.productId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/inventory/${item.productId}`}
                        className="font-medium text-slate-900 hover:text-brand-600"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.sku}</td>
                    <td className="px-4 py-3 text-slate-600">{item.brandName ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatQuantity(item.quantityOnHand)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                      {formatQuantity(item.available)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {formatCurrency(item.weightedAverageCost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatCurrency(item.inventoryValue)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StockStatusPill status={item.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/inventory/${item.productId}`}
                        className="text-sm font-medium text-brand-600 hover:text-brand-500"
                      >
                        View
                      </Link>
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
    </div>
  );
}

export const _sortableFields = [...SORTABLE];