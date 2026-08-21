import type {
  InventoryAdjustInput,
  InventoryDetail,
  InventoryListItem,
  InventoryMutationResult,
  InventoryTransaction,
  MovementFilter,
  Paginated,
  ReservationCreateInput,
  ReservationCreateResult,
  ReservationReleaseResult,
  ReservationStatus,
  StockReservation,
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

export interface ReservationListQuery {
  status?: ReservationStatus;
  productId?: string;
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
  reservations(query: ReservationListQuery = {}): Promise<Paginated<StockReservation>> {
    return apiRequest<Paginated<StockReservation>>(`/inventory/reservations${toQuery(query)}`);
  },
  reserve(input: ReservationCreateInput): Promise<ReservationCreateResult> {
    return apiRequest<ReservationCreateResult>('/inventory/reservations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  release(reservationId: string): Promise<ReservationReleaseResult> {
    return apiRequest<ReservationReleaseResult>(`/inventory/reservations/${reservationId}/release`, {
      method: 'PATCH',
    });
  },
};

export function formatCurrency(value: string | number): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
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
  RESERVATION: 'Reservation',
  RESERVATION_RELEASE: 'Reservation release',
};

export const reservationStatusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  FULFILLED: 'Fulfilled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
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