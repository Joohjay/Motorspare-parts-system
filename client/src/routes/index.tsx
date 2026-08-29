import { Suspense, lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';

import { RootLayout } from '@/components/layout/RootLayout';
import { ProtectedRoute, RequireAdmin } from '@/auth/ProtectedRoute';
import { RouteErrorPage } from '@/pages/RouteErrorPage';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage').then((m) => ({ default: m.ForbiddenPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const ProductFormPage = lazy(() => import('@/pages/catalog/ProductFormPage').then((m) => ({ default: m.ProductFormPage })));
const ProductsPage = lazy(() => import('@/pages/catalog/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const InventoryDetailPage = lazy(() => import('@/pages/inventory/InventoryDetailPage').then((m) => ({ default: m.InventoryDetailPage })));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const PosPage = lazy(() => import('@/pages/sales/PosPage').then((m) => ({ default: m.PosPage })));
const SaleDetailPage = lazy(() => import('@/pages/sales/SaleDetailPage').then((m) => ({ default: m.SaleDetailPage })));
const ReceiptPage = lazy(() => import('@/pages/sales/ReceiptPage').then((m) => ({ default: m.ReceiptPage })));
const SalesHistoryPage = lazy(() => import('@/pages/sales/SalesHistoryPage').then((m) => ({ default: m.SalesHistoryPage })));
const ExpensesPage = lazy(() => import('@/pages/finance/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status" aria-label="Loading" />
    </div>
  );
}

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <SuspenseWrapper><HomePage /></SuspenseWrapper> },
      { path: 'login', element: <SuspenseWrapper><LoginPage /></SuspenseWrapper> },
      { path: 'forgot-password', element: <SuspenseWrapper><ForgotPasswordPage /></SuspenseWrapper> },
      { path: 'reset-password', element: <SuspenseWrapper><ResetPasswordPage /></SuspenseWrapper> },
      { path: 'forbidden', element: <SuspenseWrapper><ForbiddenPage /></SuspenseWrapper> },
      {
        element: <ProtectedRoute />,
        children: [
          { path: 'dashboard', element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper> },
          { path: 'inventory', element: <SuspenseWrapper><InventoryPage /></SuspenseWrapper> },
          { path: 'inventory/:productId', element: <SuspenseWrapper><InventoryDetailPage /></SuspenseWrapper> },
          { path: 'catalog/products', element: <SuspenseWrapper><ProductsPage /></SuspenseWrapper> },
          { path: 'pos', element: <SuspenseWrapper><PosPage /></SuspenseWrapper> },
          { path: 'sales', element: <SuspenseWrapper><SalesHistoryPage /></SuspenseWrapper> },
          { path: 'sales/:id', element: <SuspenseWrapper><SaleDetailPage /></SuspenseWrapper> },
          { path: 'sales/:id/receipt', element: <SuspenseWrapper><ReceiptPage /></SuspenseWrapper> },
          { path: 'expenses', element: <SuspenseWrapper><ExpensesPage /></SuspenseWrapper> },
          { path: 'reports', element: <SuspenseWrapper><ReportsPage /></SuspenseWrapper> },
          { path: 'notifications', element: <SuspenseWrapper><NotificationsPage /></SuspenseWrapper> },
          { path: 'settings', element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
          {
            element: <RequireAdmin />,
            children: [
              { path: 'catalog/products/new', element: <SuspenseWrapper><ProductFormPage /></SuspenseWrapper> },
              { path: 'catalog/products/:id/edit', element: <SuspenseWrapper><ProductFormPage /></SuspenseWrapper> },
            ],
          },
        ],
      },
      { path: '*', element: <SuspenseWrapper><NotFoundPage /></SuspenseWrapper> },
    ],
  },
]);
