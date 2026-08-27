import type {
  AppNotification,
  BusinessSettings,
  Dashboard,
  Paginated,
  ReceiptData,
} from '@/types/api';

import { apiRequest } from '@/lib/api';

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

export const dashboardApi = {
  get(): Promise<{ dashboard: Dashboard }> {
    return apiRequest<{ dashboard: Dashboard }>('/dashboard');
  },
};

export const notificationsApi = {
  list(query: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}): Promise<Paginated<AppNotification>> {
    return apiRequest<Paginated<AppNotification>>(`/notifications${toQuery({ ...query, unreadOnly: query.unreadOnly ? 'true' : undefined })}`);
  },
  unreadCount(): Promise<{ unreadCount: number }> {
    return apiRequest<{ unreadCount: number }>('/notifications/unread-count');
  },
  markRead(id: string): Promise<{ notification: AppNotification }> {
    return apiRequest<{ notification: AppNotification }>(`/notifications/${id}/read`, { method: 'POST' });
  },
  markAllRead(): Promise<{ updatedCount: number }> {
    return apiRequest<{ updatedCount: number }>('/notifications/mark-all-read', { method: 'POST' });
  },
};

export const settingsApi = {
  get(): Promise<{ settings: Record<string, string> }> {
    return apiRequest<{ settings: Record<string, string> }>('/settings');
  },
  update(input: Partial<BusinessSettings>): Promise<{ settings: Record<string, string> }> {
    return apiRequest<{ settings: Record<string, string> }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
};

export const receiptsApi = {
  get(saleId: string): Promise<{ receipt: ReceiptData }> {
    return apiRequest<{ receipt: ReceiptData }>(`/sales/${saleId}/receipt`);
  },
};
