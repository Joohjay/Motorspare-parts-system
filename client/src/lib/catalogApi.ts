import type {
  Brand,
  BrandInput,
  CatalogStatus,
  CompatibilityEntry,
  IdentifierType,
  MotorcycleMake,
  MotorcycleMakeDetail,
  MotorcycleModel,
  MotorcycleModelDetail,
  MotorcycleVariant,
  Paginated,
  ProductDetail,
  ProductInput,
  ProductListItem,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export interface ListQuery {
  q?: string;
  status?: CatalogStatus;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  brandId?: string;
  parentId?: string;
  makeId?: string;
  modelId?: string;
  variantId?: string;
  make?: string;
  model?: string;
  variant?: string;
}

function toQuery(query: ListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const brandsApi = {
  list(query: ListQuery = {}): Promise<Paginated<Brand>> {
    return apiRequest<Paginated<Brand>>(`/brands${toQuery(query)}`);
  },
  create(input: BrandInput): Promise<{ brand: Brand }> {
    return apiRequest<{ brand: Brand }>('/brands', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(id: string, input: BrandInput): Promise<{ brand: Brand }> {
    return apiRequest<{ brand: Brand }>(`/brands/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setStatus(id: string, status: CatalogStatus): Promise<{ brand: Brand }> {
    return apiRequest<{ brand: Brand }>(`/brands/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};

export const motorcyclesApi = {
  listMakes(query: ListQuery = {}): Promise<Paginated<MotorcycleMake>> {
    return apiRequest<Paginated<MotorcycleMake>>(`/motorcycles/makes${toQuery(query)}`);
  },
  getMake(id: string): Promise<{ make: MotorcycleMakeDetail }> {
    return apiRequest<{ make: MotorcycleMakeDetail }>(`/motorcycles/makes/${id}`);
  },
  createMake(input: { name: string }): Promise<{ make: MotorcycleMake }> {
    return apiRequest<{ make: MotorcycleMake }>('/motorcycles/makes', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateMake(id: string, input: { name: string }): Promise<{ make: MotorcycleMake }> {
    return apiRequest<{ make: MotorcycleMake }>(`/motorcycles/makes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setMakeStatus(id: string, status: CatalogStatus): Promise<{ make: MotorcycleMake }> {
    return apiRequest<{ make: MotorcycleMake }>(`/motorcycles/makes/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  listModels(query: ListQuery = {}): Promise<Paginated<MotorcycleModel>> {
    return apiRequest<Paginated<MotorcycleModel>>(`/motorcycles/models${toQuery(query)}`);
  },
  getModel(id: string): Promise<{ model: MotorcycleModelDetail }> {
    return apiRequest<{ model: MotorcycleModelDetail }>(`/motorcycles/models/${id}`);
  },
  createModel(input: { makeId: string; name: string }): Promise<{ model: MotorcycleModel }> {
    return apiRequest<{ model: MotorcycleModel }>('/motorcycles/models', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateModel(id: string, input: { name: string }): Promise<{ model: MotorcycleModel }> {
    return apiRequest<{ model: MotorcycleModel }>(`/motorcycles/models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setModelStatus(id: string, status: CatalogStatus): Promise<{ model: MotorcycleModel }> {
    return apiRequest<{ model: MotorcycleModel }>(`/motorcycles/models/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  listVariants(query: ListQuery = {}): Promise<Paginated<MotorcycleVariant>> {
    return apiRequest<Paginated<MotorcycleVariant>>(`/motorcycles/variants${toQuery(query)}`);
  },
  createVariant(input: {
    modelId: string;
    name: string;
    yearFrom?: number | null;
    yearTo?: number | null;
  }): Promise<{ variant: MotorcycleVariant }> {
    return apiRequest<{ variant: MotorcycleVariant }>('/motorcycles/variants', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateVariant(
    id: string,
    input: { name?: string; yearFrom?: number | null; yearTo?: number | null },
  ): Promise<{ variant: MotorcycleVariant }> {
    return apiRequest<{ variant: MotorcycleVariant }>(`/motorcycles/variants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setVariantStatus(id: string, status: CatalogStatus): Promise<{ variant: MotorcycleVariant }> {
    return apiRequest<{ variant: MotorcycleVariant }>(`/motorcycles/variants/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};

export const productsApi = {
  list(query: ListQuery = {}): Promise<Paginated<ProductListItem>> {
    return apiRequest<Paginated<ProductListItem>>(`/products${toQuery(query)}`);
  },
  get(id: string): Promise<{ product: ProductDetail }> {
    return apiRequest<{ product: ProductDetail }>(`/products/${id}`);
  },
  create(input: ProductInput): Promise<{ product: ProductDetail }> {
    return apiRequest<{ product: ProductDetail }>('/products', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(id: string, input: ProductInput): Promise<{ product: ProductDetail }> {
    return apiRequest<{ product: ProductDetail }>(`/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setStatus(id: string, status: CatalogStatus): Promise<{ product: ProductDetail }> {
    return apiRequest<{ product: ProductDetail }>(`/products/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};

export const compatibilityApi = {
  listByProduct(productId: string): Promise<{ items: CompatibilityEntry[] }> {
    return apiRequest<{ items: CompatibilityEntry[] }>(`/compatibility/products/${productId}`);
  },
  add(input: { productId: string; variantId: string; notes?: string | null }): Promise<{
    compatibility: CompatibilityEntry;
  }> {
    return apiRequest<{ compatibility: CompatibilityEntry }>('/compatibility', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  remove(id: string): Promise<void> {
    return apiRequest<void>(`/compatibility/${id}`, { method: 'DELETE' });
  },
};

export const identifierTypes: IdentifierType[] = [
  'PART_NUMBER',
  'OEM_NUMBER',
  'ALTERNATIVE_NUMBER',
  'SUPPLIER_NUMBER',
  'OTHER',
];

export function formatPrice(value: number | string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `TZS ${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}