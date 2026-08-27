import type {
  InventoryAdjustInput,
  InventoryDetail,
  InventoryListItem,
  InventoryMutationResult,
  InventoryTransaction,
  MovementFilter,
  Paginated,
  StockStatus,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export interface InventoryListQuery {
  q?: string;
  categoryId?: string;
  brandId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  makeId?: string;
  modelId?: string;
  variantId?: string;
  stockStatus?: StockStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface TransactionListQuery {
  type?: string;
  movement?: MovementFilter;
  userId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface LowStockQuery {
  q?: string;
  categoryId?: string;
  brandId?: string;
  stockStatus?: 'LOW_STOCK' | 'OUT_OF_STOCK';
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

export const inventoryApi = {
  list(query: InventoryListQuery = {}): Promise<Paginated<InventoryListItem>> {
    return apiRequest<Paginated<InventoryListItem>>(`/inventory${toQuery(query)}`);
  },
  lowStock(query: LowStockQuery = {}): Promise<Paginated<InventoryListItem>> {
    return apiRequest<Paginated<InventoryListItem>>(`/inventory/low-stock${toQuery(query)}`);
  },
  get(productId: string): Promise<{ inventory: InventoryDetail }> {
    return apiRequest<{ inventory: InventoryDetail }>(`/inventory/${productId}`);
  },
  transactions(
    productId: string,
    query: TransactionListQuery = {},
  ): Promise<Paginated<InventoryTransaction>> {
    return apiRequest<Paginated<InventoryTransaction>>(
      `/inventory/${productId}/transactions${toQuery(query)}`,
    );
  },
  adjust(
    productId: string,
    input: InventoryAdjustInput,
  ): Promise<InventoryMutationResult> {
    return apiRequest<InventoryMutationResult>(`/inventory/${productId}/adjust`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};

export function formatCurrency(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `TZS ${formatted}`;
}

export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : String(value);
}

export const transactionTypeLabels: Record<string, string> = {
  INITIAL: 'Initial stock',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  SALE_RETURN: 'Sale return',
  PURCHASE_RETURN: 'Purchase return',
  ADJUSTMENT: 'Adjustment',
  DAMAGE: 'Damage',
  LOSS: 'Loss',
};

export const stockStatusLabels: Record<StockStatus, string> = {
  HEALTHY: 'Healthy',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

export const stockStatusOrder: Record<StockStatus, number> = {
  OUT_OF_STOCK: 0,
  LOW_STOCK: 1,
  HEALTHY: 2,
};