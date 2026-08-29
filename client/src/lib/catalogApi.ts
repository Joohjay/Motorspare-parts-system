import type {
  Brand,
  BrandInput,
  CatalogStatus,
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
  remove(id: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/products/${id}`, {
      method: 'DELETE',
    });
  },
};

export function formatPrice(value: number | string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `TZS ${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}