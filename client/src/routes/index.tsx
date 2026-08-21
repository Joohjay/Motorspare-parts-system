import { createBrowserRouter } from 'react-router-dom';

import { RootLayout } from '@/components/layout/RootLayout';
import { ProtectedRoute, RequireAdmin } from '@/auth/ProtectedRoute';
import { DashboardPage } from '@/pages/DashboardPage';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';
import { BrandsPage } from '@/pages/catalog/BrandsPage';
import { CategoriesPage } from '@/pages/catalog/CategoriesPage';
import { MotorcyclesPage } from '@/pages/catalog/MotorcyclesPage';
import { ProductFormPage } from '@/pages/catalog/ProductFormPage';
import { ProductsPage } from '@/pages/catalog/ProductsPage';
import { InventoryDetailPage } from '@/pages/inventory/InventoryDetailPage';
import { InventoryPage } from '@/pages/inventory/InventoryPage';
import { ReservationsPage } from '@/pages/inventory/ReservationsPage';
import { PurchaseOrdersPage } from '@/pages/purchasing/PurchaseOrdersPage';
import { PurchasesPage } from '@/pages/purchasing/PurchasesPage';
import { SupplierCreditPage } from '@/pages/purchasing/SupplierCreditPage';
import { SuppliersPage } from '@/pages/purchasing/SuppliersPage';
import { PosPage } from '@/pages/sales/PosPage';
import { SaleDetailPage } from '@/pages/sales/SaleDetailPage';
import { SalesHistoryPage } from '@/pages/sales/SalesHistoryPage';
import { SalesReturnsPage } from '@/pages/sales/SalesReturnsPage';
import { CustomerDetailPage } from '@/pages/customers/CustomerDetailPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { ExpensesPage } from '@/pages/finance/ExpensesPage';
import { ReportsPage } from '@/pages/reports/ReportsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'forbidden', element: <ForbiddenPage /> },
      {
        element: <ProtectedRoute />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'inventory', element: <InventoryPage /> },
          { path: 'inventory/reservations', element: <ReservationsPage /> },
          { path: 'inventory/:productId', element: <InventoryDetailPage /> },
          { path: 'catalog/products', element: <ProductsPage /> },
          { path: 'catalog/categories', element: <CategoriesPage /> },
          { path: 'catalog/brands', element: <BrandsPage /> },
          { path: 'catalog/motorcycles', element: <MotorcyclesPage /> },
          { path: 'purchasing/suppliers', element: <SuppliersPage /> },
          { path: 'purchasing/purchase-orders', element: <PurchaseOrdersPage /> },
          { path: 'purchasing/purchases', element: <PurchasesPage /> },
          { path: 'purchasing/credit', element: <SupplierCreditPage /> },
          { path: 'pos', element: <PosPage /> },
          { path: 'sales', element: <SalesHistoryPage /> },
          { path: 'sales/returns', element: <SalesReturnsPage /> },
          { path: 'sales/:id', element: <SaleDetailPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerDetailPage /> },
          { path: 'expenses', element: <ExpensesPage /> },
          { path: 'reports', element: <ReportsPage /> },
          {
            element: <RequireAdmin />,
            children: [
              { path: 'catalog/products/new', element: <ProductFormPage /> },
              { path: 'catalog/products/:id/edit', element: <ProductFormPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);