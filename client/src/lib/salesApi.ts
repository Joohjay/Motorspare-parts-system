import type {
  Paginated,
  PaymentMethod,
  Sale,
  SaleCreateInput,
  SaleListItem,
  SaleVoidResult,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export interface SaleListQuery {
  q?: string;
  status?: 'COMPLETED' | 'VOID';
  saleType?: 'RETAIL' | 'WHOLESALE';
  paymentMethod?: PaymentMethod;
  createdById?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function toQuery(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const salesApi = {
  create(input: SaleCreateInput): Promise<{ sale: Sale }> {
    return apiRequest<{ sale: Sale }>('/sales', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  get(id: string): Promise<{ sale: Sale }> {
    return apiRequest<{ sale: Sale }>(`/sales/${id}`);
  },
  list(query: SaleListQuery = {}): Promise<Paginated<SaleListItem>> {
    return apiRequest<Paginated<SaleListItem>>(`/sales${toQuery(query)}`);
  },
  void(id: string, reason: string): Promise<SaleVoidResult> {
    return apiRequest<SaleVoidResult>(`/sales/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};

export const saleStatusLabels: Record<string, string> = {
  COMPLETED: 'Completed',
  VOID: 'Voided',
};

export const saleStatusClasses: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  VOID: 'bg-red-50 text-red-700 ring-red-200',
};

export const saleTypeLabels: Record<string, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
};
