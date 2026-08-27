import type {
  DailySalesPoint,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  ExpenseSummaryReport,
  FinancialReport,
  Paginated,
  PaymentMethodTotals,
  ReportRange,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

export interface ExpenseListQuery {
  categoryId?: string;
  status?: 'ACTIVE' | 'VOID';
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ReportRangeQuery {
  preset?: 'today' | 'yesterday' | 'this_week' | 'this_month';
  from?: string;
  to?: string;
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

export const expensesApi = {
  listCategories(): Promise<{ items: ExpenseCategory[] }> {
    return apiRequest<{ items: ExpenseCategory[] }>('/finance/expense-categories');
  },
  createCategory(input: { name: string; description?: string | null }): Promise<{ category: ExpenseCategory }> {
    return apiRequest<{ category: ExpenseCategory }>('/finance/expense-categories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  list(query: ExpenseListQuery = {}): Promise<Paginated<Expense>> {
    return apiRequest<Paginated<Expense>>(`/finance/expenses${toQuery(query)}`);
  },
  create(input: ExpenseInput): Promise<{ expense: Expense }> {
    return apiRequest<{ expense: Expense }>('/finance/expenses', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  void(id: string): Promise<{ expense: Expense }> {
    return apiRequest<{ expense: Expense }>(`/finance/expenses/${id}/void`, { method: 'POST' });
  },
};

export const reportsApi = {
  sales(query: ReportRangeQuery): Promise<{ range: ReportRange; summary: unknown; payments: PaymentMethodTotals[]; daily: DailySalesPoint[] }> {
    return apiRequest(`/finance/reports/sales${toQuery(query)}`);
  },
  financial(query: ReportRangeQuery): Promise<FinancialReport> {
    return apiRequest<FinancialReport>(`/finance/reports/financial${toQuery(query)}`);
  },
  expenses(query: ReportRangeQuery): Promise<{ range: ReportRange } & ExpenseSummaryReport> {
    return apiRequest(`/finance/reports/expenses${toQuery(query)}`);
  },
};

export const expenseStatusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  VOID: 'Voided',
};

export const expenseStatusClasses: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  VOID: 'bg-red-50 text-red-700 ring-red-200',
};
