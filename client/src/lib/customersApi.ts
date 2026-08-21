import type {
  Customer,
  CustomerCreditAccount,
  CustomerCreditPayment,
  CustomerDetail,
  CustomerInput,
  CustomerListItem,
  CustomerStatement,
  CustomerType,
  Paginated,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export interface CustomerListQuery {
  q?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  type?: CustomerType;
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

export const customersApi = {
  list(query: CustomerListQuery = {}): Promise<Paginated<CustomerListItem>> {
    return apiRequest<Paginated<CustomerListItem>>(`/customers${toQuery(query)}`);
  },
  get(id: string): Promise<{ customer: CustomerDetail }> {
    return apiRequest<{ customer: CustomerDetail }>(`/customers/${id}`);
  },
  create(input: CustomerInput): Promise<{ customer: Customer }> {
    return apiRequest<{ customer: Customer }>('/customers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(id: string, input: Partial<CustomerInput>): Promise<{ customer: Customer }> {
    return apiRequest<{ customer: Customer }>(`/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  setStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<{ customer: Customer }> {
    return apiRequest<{ customer: Customer }>(`/customers/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};

export const customerCreditApi = {
  openAccount(customerId: string): Promise<{ creditAccount: CustomerCreditAccount }> {
    return apiRequest<{ creditAccount: CustomerCreditAccount }>(`/customers/${customerId}/credit-account`, {
      method: 'POST',
    });
  },
  getAccount(customerId: string): Promise<{ creditAccount: CustomerCreditAccount }> {
    return apiRequest<{ creditAccount: CustomerCreditAccount }>(`/customers/${customerId}/credit-account`);
  },
  setLimit(customerId: string, creditLimit: number): Promise<{ creditAccount: CustomerCreditAccount }> {
    return apiRequest<{ creditAccount: CustomerCreditAccount }>(`/customers/${customerId}/credit-limit`, {
      method: 'PATCH',
      body: JSON.stringify({ creditLimit }),
    });
  },
  recordPayment(
    customerId: string,
    input: { amount: number; paymentMethod: string; reference?: string | null; paidAt?: string },
  ): Promise<{ payment: CustomerCreditPayment; newBalance: string }> {
    return apiRequest<{ payment: CustomerCreditPayment; newBalance: string }>(
      `/customers/${customerId}/credit-payments`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
  payments(customerId: string): Promise<Paginated<CustomerCreditPayment>> {
    return apiRequest<Paginated<CustomerCreditPayment>>(`/customers/${customerId}/credit-payments`);
  },
  statement(
    customerId: string,
    query: { from?: string; to?: string } = {},
  ): Promise<CustomerStatement> {
    return apiRequest<CustomerStatement>(`/customers/${customerId}/statement${toQuery(query)}`);
  },
};

export const customerTypeLabels: Record<CustomerType, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  MECHANIC: 'Mechanic',
  GARAGE: 'Garage',
  BUSINESS: 'Business',
  OTHER: 'Other',
};

export const customerStatusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};
