import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  EmptyState,
  ErrorState,
  LoadingState,
  errorMessage,
} from '@/components/ui/FormControls';
import { Button } from '@/components/ui/Button';
import { notificationsApi } from '@/lib/stage8Api';
import type { AppNotification as NotificationItem } from '@/types/api';

const TYPE_LABELS: Record<string, string> = {
  GENERAL: 'General',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
  CUSTOMER_CREDIT_DUE: 'Customer credit due',
  SUPPLIER_PAYMENT_DUE: 'Supplier payment due',
  PURCHASE_ORDER_PENDING: 'Purchase order pending',
  RESERVATION_PENDING: 'Reservation pending',
};

export function NotificationsPage(): ReactElement {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await notificationsApi.list({ unreadOnly, pageSize: 50 });
      setItems(page.items);
    } catch (err) {
      setError(errorMessage(err, 'Could not load notifications'));
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFilter = () => {
    setUnreadOnly((value) => !value);
  };

  const markRead = async (notification: NotificationItem) => {
    if (notification.readAt) return;
    try {
      await notificationsApi.markRead(notification.id);
      setItems((current) =>
        (current ?? []).map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
    } catch {
      // best-effort
    }
  };

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setItems((current) => (current ?? []).map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch {
      // best-effort
    }
  };

  if (error && items === null) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-0.5 text-sm text-slate-500">Alerts about stock levels and pending work, private to you.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={unreadOnly ? 'primary' : 'secondary'} onClick={toggleFilter}>
            {unreadOnly ? 'Showing unread' : 'Show unread only'}
          </Button>
          <Button variant="secondary" onClick={() => void markAllRead()}>
            Mark all read
          </Button>
        </div>
      </div>

      {items === null ? (
        <LoadingState label="Loading notifications…" />
      ) : items.length === 0 ? (
        <EmptyState message={unreadOnly ? 'You are all caught up.' : 'No notifications yet.'} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${notification.readAt ? '' : 'bg-brand-50/40'}`}
                onClick={() => void markRead(notification)}
                title={notification.readAt ? 'Read' : 'Click to mark as read'}
              >
                <div className="flex items-start gap-3">
                  {!notification.readAt ? (
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                  ) : (
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${notification.readAt ? 'text-slate-600' : 'font-semibold text-slate-900'}`}>
                        {notification.title}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {TYPE_LABELS[notification.type] ?? notification.type}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">
                        {new Date(notification.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">{notification.message}</span>
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
