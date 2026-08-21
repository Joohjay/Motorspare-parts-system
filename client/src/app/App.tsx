import { RouterProvider } from 'react-router-dom';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AuthProvider } from '@/auth/AuthContext';
import { router } from '@/routes';

export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppErrorBoundary>
  );
}