import type {
  Paginated,
  Purchase,
  PurchaseCreateInput,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderStatus,
  Supplier,
  SupplierCreditAccount,
  SupplierCreditPayment,
  SupplierInput,
  SupplierProduct,
  SupplierProductInput,
  SupplierStatus,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export interface SupplierListQuery {
  q?: string;
  status?: SupplierStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface PurchaseOrderListQuery {
  supplierId?: string;
  status?: PurchaseOrderStatus;
  q?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface PurchaseListQuery {
  supplierId?: string;
  purchaseOrderId?: string;
  paymentStatus?: string;
  q?: string;
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

export const suppliersApi = {
  list(query: SupplierListQuery = {}): Promise<Paginated<Supplier>> {
    return apiRequest<Paginated<Supplier>>(`/suppliers${toQuery(query)}`);
  },
  get(id: string): Promise<{ supplier: Supplier }> {
    return apiRequest<{ supplier: Supplier }>(`/suppliers/${id}`);
  },
  create(input: SupplierInput): Promise<{ supplier: Supplier }> {
    return apiRequest<{ supplier: Supplier }>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(id: string, input: Partial<SupplierInput>): Promise<{ supplier: Supplier }> {
    return apiRequest<{ supplier: Supplier }>(`/suppliers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setStatus(id: string, status: SupplierStatus): Promise<{ supplier: Supplier }> {
    return apiRequest<{ supplier: Supplier }>(`/suppliers/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
  listProducts(supplierId: string): Promise<{ items: SupplierProduct[] }> {
    return apiRequest<{ items: SupplierProduct[] }>(`/suppliers/${supplierId}/products`);
  },
  linkProduct(
    supplierId: string,
    input: SupplierProductInput,
  ): Promise<{ supplierProduct: SupplierProduct }> {
    return apiRequest<{ supplierProduct: SupplierProduct }>(`/suppliers/${supplierId}/products`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateProduct(
    linkId: string,
    input: Partial<Omit<SupplierProductInput, 'productId'>> & { status?: 'ACTIVE' | 'INACTIVE' },
  ): Promise<{ supplierProduct: SupplierProduct }> {
    return apiRequest<{ supplierProduct: SupplierProduct }>(`/supplier-products/${linkId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  unlinkProduct(linkId: string): Promise<void> {
    return apiRequest<void>(`/supplier-products/${linkId}`, { method: 'DELETE' });
  },
};

export const purchaseOrdersApi = {
  list(query: PurchaseOrderListQuery = {}): Promise<Paginated<PurchaseOrder>> {
    return apiRequest<Paginated<PurchaseOrder>>(`/purchase-orders${toQuery(query)}`);
  },
  get(id: string): Promise<{ purchaseOrder: PurchaseOrder }> {
    return apiRequest<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${id}`);
  },
  create(input: PurchaseOrderInput): Promise<{ purchaseOrder: PurchaseOrder }> {
    return apiRequest<{ purchaseOrder: PurchaseOrder }>('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(id: string, input: Partial<PurchaseOrderInput>): Promise<{ purchaseOrder: PurchaseOrder }> {
    return apiRequest<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  submit(id: string): Promise<{ purchaseOrder: PurchaseOrder }> {
    return apiRequest<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${id}/submit`, {
      method: 'POST',
    });
  },
  cancel(id: string): Promise<{ purchaseOrder: PurchaseOrder }> {
    return apiRequest<{ purchaseOrder: PurchaseOrder }>(`/purchase-orders/${id}/cancel`, {
      method: 'POST',
    });
  },
};

export const purchasesApi = {
  list(query: PurchaseListQuery = {}): Promise<Paginated<Purchase>> {
    return apiRequest<Paginated<Purchase>>(`/purchases${toQuery(query)}`);
  },
  get(id: string): Promise<{ purchase: Purchase }> {
    return apiRequest<{ purchase: Purchase }>(`/purchases/${id}`);
  },
  receive(input: PurchaseCreateInput): Promise<{ purchase: Purchase }> {
    return apiRequest<{ purchase: Purchase }>('/purchases', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};

export const supplierCreditApi = {
  get(supplierId: string): Promise<{ creditAccount: SupplierCreditAccount }> {
    return apiRequest<{ creditAccount: SupplierCreditAccount }>(`/supplier-credit/${supplierId}`);
  },
  openAccount(supplierId: string): Promise<{ creditAccount: SupplierCreditAccount }> {
    return apiRequest<{ creditAccount: SupplierCreditAccount }>(`/supplier-credit/${supplierId}/account`, {
      method: 'POST',
    });
  },
  payments(supplierId: string): Promise<Paginated<SupplierCreditPayment>> {
    return apiRequest<Paginated<SupplierCreditPayment>>(`/supplier-credit/${supplierId}/payments`);
  },
  recordPayment(
    supplierId: string,
    input: { purchaseId?: string | null; amount: number; paymentMethod: string; reference?: string | null },
  ): Promise<{ payment: SupplierCreditPayment; creditAccount: SupplierCreditAccount }> {
    return apiRequest<{ payment: SupplierCreditPayment; creditAccount: SupplierCreditAccount }>(
      `/supplier-credit/${supplierId}/payments`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
};

export const supplierStatusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const purchaseOrderStatusLabels: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Submitted',
  PARTIALLY_RECEIVED: 'Partially received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export const purchaseOrderStatusClasses: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  PARTIALLY_RECEIVED: 'bg-blue-50 text-blue-700 ring-blue-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
};

export const paymentStatusLabels: Record<string, string> = {
  UNPAID: 'Unpaid',
  PARTIAL: 'Partial',
  PAID: 'Paid',
};

export const paymentMethodLabels: Record<string, string> = {
  CASH: 'Cash',
  BANK: 'Bank transfer',
  MPESA: 'M-Pesa',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};
