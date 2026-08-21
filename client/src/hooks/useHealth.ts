import { useEffect, useState } from 'react';

import { apiRequest } from '@/lib/api';
import type { HealthResponse } from '@/types/api';

interface HealthState {
  data: HealthResponse | null;
  loading: boolean;
  error: string | null;
}

// Demonstrates the shared loading/error state architecture for data fetching.
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    apiRequest<HealthResponse>('/health')
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}