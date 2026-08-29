export interface HealthResponse {
  status: string;
  service: string;
  database: 'up' | 'down';
  timestamp: string;
  uptime: number;
}

export type UserRole = 'ADMIN' | 'ASSISTANT';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

/** Safe user representation — never includes password hashes or tokens. */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
}

export interface CsrfResponse {
  csrfToken: string;
}

export interface LoginResponse {
  user: SafeUser;
}

export interface MeResponse {
  user: SafeUser;
}

export interface MessageResponse {
  message: string;
}

export interface UpdateAccountStatusResponse {
  user: SafeUser;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type CatalogStatus = 'ACTIVE' | 'INACTIVE';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

// Categories removed (feature removed).

// Brands --------------------------------------------------------------------

export interface Brand {
  id: string;
  name: string;
  status: CatalogStatus;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandInput {
  name: string;
}

// Products ------------------------------------------------------------------

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  status: CatalogStatus;
  brandId: string | null;
  costPrice: number | string;
  retailPrice: number | string;
  wholesalePrice: number | string;
  brand: { id: string; name: string; status: CatalogStatus } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  minimumStock: number;
  reorderLevel: number;
}

export interface ProductInput {
  sku: string;
  name: string;
  description?: string | null;
  brandId?: string | null;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  minimumStock?: number;
  reorderLevel?: number;
  status?: CatalogStatus;
  quantityOnHand?: number;
}

export interface ProductStatusInput {
  status: CatalogStatus;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type StockStatus = 'HEALTHY' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export type InventoryTransactionType =
  | 'INITIAL'
  | 'PURCHASE'
  | 'SALE'
  | 'SALE_RETURN'
  | 'PURCHASE_RETURN'
  | 'ADJUSTMENT'
  | 'DAMAGE'
  | 'LOSS'
  | 'RESERVATION'
  | 'RESERVATION_RELEASE';

export type MovementFilter = 'in' | 'out' | 'reservation';

export interface InventoryListItem {
  productId: string;
  sku: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  quantityOnHand: number;
  available: number;
  weightedAverageCost: string;
  inventoryValue: string;
  status: StockStatus;
  updatedAt: string;
}

export interface InventoryDetail extends InventoryListItem {
  categoryId: string | null;
  categoryName: string | null;
  quantityReserved: number;
}

export interface InventoryTransaction {
  id: string;
  productId: string;
  type: InventoryTransactionType;
  quantity: number;
  unitCost: string | null;
  balanceAfter: number;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  product: { id: string; sku: string; name: string };
  createdBy: { id: string; fullName: string } | null;
}

export interface InventoryAdjustInput {
  quantity: number;
  reason: string;
  type?: 'ADJUSTMENT' | 'DAMAGE' | 'LOSS';
}

export interface InventoryMutationResult {
  inventory: InventoryDetail;
  transactionId: string;
  notificationsCreated: number;
}

export type PaymentMethod = 'CASH' | 'BANK' | 'MPESA' | 'CHEQUE' | 'OTHER';

// ---------------------------------------------------------------------------
// Sales & customers (Stage 7)
// ---------------------------------------------------------------------------

export type SaleStatus = 'COMPLETED' | 'VOID';
export type SaleType = 'RETAIL' | 'WHOLESALE';
export type ExpenseStatus = 'ACTIVE' | 'VOID';

export interface SaleItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  unitCost?: string;
  lineCost?: string;
}

export interface SalePayment {
  id: string;
  paymentMethod: PaymentMethod;
  amount: string;
  reference: string | null;
  paidAt: string;
}

export interface Sale {
  id: string;
  saleNumber: string;
  saleType: SaleType;
  status: SaleStatus;
  subtotal: string;
  discount: string;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  items: SaleItem[];
  payments: SalePayment[];
  cogs?: string;
  grossProfit?: string;
}

export interface SaleListItem {
  id: string;
  saleNumber: string;
  saleType: SaleType;
  status: SaleStatus;
  totalAmount: string;
  discount: string;
  itemCount: number;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface SaleLineInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
}

export interface SalePaymentInput {
  paymentMethod: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export interface SaleCreateInput {
  items: SaleLineInput[];
  payments: SalePaymentInput[];
  saleType?: SaleType;
  notes?: string | null;
}

export interface SaleVoidResult {
  sale: { id: string; saleNumber: string; status: SaleStatus };
}

// ---------------------------------------------------------------------------
// Expenses & reports (Stage 7)
// ---------------------------------------------------------------------------

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  status: CatalogStatus;
  expenseCount: number;
  createdAt: string;
}

export interface Expense {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: string;
  expenseDate: string;
  description: string | null;
  reference: string | null;
  paymentMethod: PaymentMethod | null;
  status: ExpenseStatus;
  createdBy: { id: string; fullName: string };
  createdAt: string;
}

export interface ExpenseInput {
  categoryId: string;
  amount: number;
  expenseDate?: string;
  description?: string | null;
  reference?: string | null;
  paymentMethod?: PaymentMethod | null;
}

export interface ReportRange {
  from: string;
  to: string;
}

export interface SalesSummaryReport {
  saleCount: number;
  revenue: string;
  cogs: string;
  grossProfit: string;
  discounts: string;
}

export interface PaymentMethodTotals {
  paymentMethod: PaymentMethod;
  total: string;
}

export interface DailySalesPoint {
  day: string;
  revenue: string;
  orders: number;
}

export interface ExpenseSummaryReport {
  total: string;
  byCategory: Array<{ categoryId: string; categoryName: string; total: string }>;
}

export interface FinancialReport {
  range: { from: Date | string; to: Date | string };
  sales: SalesSummaryReport;
  payments: PaymentMethodTotals[];
  expenses: ExpenseSummaryReport;
  netOperatingResult: {
    grossProfit: string;
    operatingExpenses: string;
    netOperatingResult: string;
  };
}

// ---------------------------------------------------------------------------
// Stage 8 — receipts, dashboard, notifications, settings
// ---------------------------------------------------------------------------

export interface ReceiptData {
  business: Record<string, string>;
  sale: Sale;
}

export interface DashboardPaymentEntry {
  paymentMethod: PaymentMethod;
  total: number;
}

export interface DashboardInventoryAlertItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  minimumStock: number;
}

export interface DashboardTopProduct {
  productId: string;
  sku: string;
  name: string;
  unitsSold: number;
  revenue: number;
}

export interface Dashboard {
  generatedAt: string;
  todaySales: {
    saleCount: number;
    revenue: number;
    discounts: number;
    averageSaleValue: number;
  };
  paymentBreakdownToday: DashboardPaymentEntry[];
  inventoryAlerts: {
    lowStockCount: number;
    outOfStockCount: number;
    lowStockItems: DashboardInventoryAlertItem[];
  };
  recentSales: Array<{
    id: string;
    saleNumber: string;
    status: SaleStatus;
    totalAmount: number;
    createdAt: string;
    cashierName: string;
  }>;
  topProductsThisMonth: DashboardTopProduct[];
  // ADMIN-only
  todayFinancials?: {
    cogs: number;
    grossProfit: number;
    expensesTotal: number;
    netProfit: number;
  };
}

export type NotificationType =
  | 'GENERAL'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface BusinessSettings {
  'business.name': string;
  'business.address': string;
  'business.phone': string;
  'business.email': string;
  'business.currency': string;
  'business.timezone': string;
  'business.receiptFooter': string;
  'printing.receiptPrinter': string;
  'printing.receiptMode': string;
  'printing.receiptWidth': string;
}
