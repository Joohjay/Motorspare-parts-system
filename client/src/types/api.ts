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
export type IdentifierType =
  | 'PART_NUMBER'
  | 'OEM_NUMBER'
  | 'ALTERNATIVE_NUMBER'
  | 'SUPPLIER_NUMBER'
  | 'OTHER';

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

// Motorcycles ---------------------------------------------------------------

export interface MotorcycleMake {
  id: string;
  name: string;
  status: CatalogStatus;
  modelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MotorcycleMakeDetail extends MotorcycleMake {
  models: { id: string; name: string; status: CatalogStatus }[];
}

export interface MotorcycleModel {
  id: string;
  makeId: string;
  name: string;
  status: CatalogStatus;
  make: { id: string; name: string; status: CatalogStatus };
  variantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MotorcycleModelDetail extends MotorcycleModel {
  variants: {
    id: string;
    name: string;
    status: CatalogStatus;
    yearFrom: number | null;
    yearTo: number | null;
  }[];
}

export interface MotorcycleVariant {
  id: string;
  modelId: string;
  name: string;
  yearFrom: number | null;
  yearTo: number | null;
  status: CatalogStatus;
  model: {
    id: string;
    name: string;
    status: CatalogStatus;
    make: { id: string; name: string; status: CatalogStatus };
  };
  compatibilityCount: number;
  createdAt: string;
  updatedAt: string;
}

// Products ------------------------------------------------------------------

export interface Identifier {
  id: string;
  type: IdentifierType;
  value: string;
}

export interface IdentifierInput {
  type: IdentifierType;
  value: string;
}

export interface CompatibilityEntry {
  id: string;
  notes: string | null;
  variant: {
    id: string;
    name: string;
    yearFrom: number | null;
    yearTo: number | null;
    model: { id: string; name: string; make: { id: string; name: string } };
  };
}

export interface CompatibilityInput {
  variantId: string;
  notes?: string | null;
}

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  status: CatalogStatus;
  brandId: string | null;
  retailPrice: number | string;
  wholesalePrice: number | string;
  brand: { id: string; name: string; status: CatalogStatus } | null;
  identifiers: Identifier[];
  compatibilityCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  minimumStock: number;
  reorderLevel: number;
  compatibilities: CompatibilityEntry[];
}

export interface ProductInput {
  sku: string;
  name: string;
  description?: string | null;
  brandId?: string | null;
  retailPrice: number;
  wholesalePrice: number;
  minimumStock?: number;
  reorderLevel?: number;
  status?: CatalogStatus;
  identifiers?: IdentifierInput[];
  compatibility?: CompatibilityInput[];
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
  identifiers: Identifier[];
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

// ---------------------------------------------------------------------------
// Purchasing (suppliers, purchase orders, receiving, credit)
// ---------------------------------------------------------------------------

export type SupplierStatus = 'ACTIVE' | 'INACTIVE';
export type SupplierProductStatus = 'ACTIVE' | 'INACTIVE';
export type PurchaseOrderStatus = 'DRAFT' | 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export type PurchaseStatus = 'COMPLETED';
export type PurchasePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export type PaymentMethod = 'CASH' | 'BANK' | 'MPESA' | 'CHEQUE' | 'OTHER';

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: SupplierStatus;
  createdAt: string;
  updatedAt: string;
  creditAccount: { outstandingBalance: string; status: 'ACTIVE' | 'CLOSED' } | null;
}

export interface SupplierInput {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface SupplierProduct {
  id: string;
  supplierId: string;
  productId: string;
  supplierCode: string | null;
  unitCost: string | null;
  leadTimeDays: number | null;
  status: SupplierProductStatus;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string; status: CatalogStatus };
}

export interface SupplierProductInput {
  productId: string;
  supplierCode?: string | null;
  unitCost?: number | null;
  leadTimeDays?: number | null;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  quantityOrdered: number;
  unitCost: string;
  notes: string | null;
  product: { id: string; sku: string; name: string; status: CatalogStatus };
  received: number;
  remaining: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDelivery: string | null;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: { id: string; name: string; status: SupplierStatus };
  createdBy: { id: string; fullName: string } | null;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderListItem extends PurchaseOrder {
  itemCount?: number;
}

export interface PurchaseOrderItemInput {
  productId: string;
  quantityOrdered: number;
  unitCost: number;
  notes?: string | null;
}

export interface PurchaseOrderInput {
  supplierId: string;
  expectedDelivery?: string | null;
  notes?: string | null;
  items: PurchaseOrderItemInput[];
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  purchaseOrderItemId: string | null;
  productId: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityDamaged: number;
  quantityMissing: number;
  quantityAccepted: number;
  unitCost: string;
  lineTotal: string;
  product: { id: string; sku: string; name: string; status: CatalogStatus };
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  purchaseOrderId: string | null;
  supplierId: string;
  invoiceReference: string | null;
  status: PurchaseStatus;
  paymentStatus: PurchasePaymentStatus;
  receivedAt: string;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string; status: SupplierStatus };
  purchaseOrder: { id: string; orderNumber: string; status: PurchaseOrderStatus } | null;
  creditAccount: { id: string; outstandingBalance: string; status: 'ACTIVE' | 'CLOSED' } | null;
  createdBy: { id: string; fullName: string } | null;
  items: PurchaseItem[];
}

export interface ReceiveItemInput {
  purchaseOrderItemId?: string;
  productId: string;
  quantityReceived: number;
  quantityDamaged?: number;
  quantityMissing?: number;
  unitCost?: number;
  quantityOrdered?: number;
}

export interface PurchaseCreateInput {
  purchaseOrderId?: string;
  supplierId?: string;
  invoiceReference?: string | null;
  notes?: string | null;
  items: ReceiveItemInput[];
}

export interface SupplierCreditAccount {
  id: string;
  supplierId: string;
  creditLimit: string;
  outstandingBalance: string;
  status: 'ACTIVE' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  payments: SupplierCreditPayment[];
  _count: { payments: number; purchases: number };
}

export interface SupplierCreditPayment {
  id: string;
  accountId: string;
  purchaseId: string | null;
  amount: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  paidAt: string;
  createdAt: string;
  purchase: { id: string; purchaseNumber: string } | null;
  createdBy: { id: string; fullName: string } | null;
}
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
  recentPurchases: Array<{
    id: string;
    purchaseNumber: string;
    status: PurchaseOrderStatus | PurchaseStatus;
    totalAmount: number;
    createdAt: string;
    supplierName: string;
  }>;
  pendingPurchaseOrders: number;
  supplierCredit: {
    activeAccounts: number;
    totalOutstanding: number;
  };
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
  | 'OUT_OF_STOCK'
  | 'SUPPLIER_PAYMENT_DUE'
  | 'PURCHASE_ORDER_PENDING';

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
}
