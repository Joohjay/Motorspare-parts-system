import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { notificationsApi } from '@/lib/stage8Api';
import type { AppNotification } from '@/types/api';

/**
 * Notification bell (Stage 8). Polls the unread count roughly once a minute
 * and opens a dropdown of the latest items; the full inbox lives on
 * /notifications. Unread items are marked with both a dot AND bold text so
 * state is never conveyed by colour alone.
 */
export function NotificationBell(): ReactElement {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const { unreadCount } = await notificationsApi.unreadCount();
        if (active) setUnreadCount(unreadCount);
      } catch {
        // polling is best-effort; ignore transient failures
      }
    };
    void poll();
    const timer = window.setInterval(poll, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Refresh when navigating (e.g. after marking read elsewhere).
  useEffect(() => {
    setOpen(false);
    let active = true;
    notificationsApi
      .unreadCount()
      .then(({ unreadCount }) => {
        if (active) setUnreadCount(unreadCount);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const page = await notificationsApi.list({ pageSize: 8 });
        setItems(page.items);
      } catch {
        setItems([]);
      }
    };
    void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch {
      // best-effort
    }
  };

  const markRead = async (notification: AppNotification) => {
    if (notification.readAt) return;
    try {
      await notificationsApi.markRead(notification.id);
      setItems((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      // best-effort
    }
  };

  return (
    <div ref={containerRef} className="relative print:hidden">
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        onClick={() => setOpen((value) => !value)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notifications</p>
            <button
              type="button"
              className="text-xs font-medium text-brand-700 hover:underline disabled:text-slate-400"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No notifications yet.</li>
            ) : (
              items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => void markRead(notification)}
                    title={notification.readAt ? 'Read' : 'Click to mark as read'}
                  >
                    <span className="flex items-start gap-2">
                      {!notification.readAt ? (
                        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                      ) : (
                        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0" />
                      )}
                      <span className="min-w-0">
                        <span className={`block truncate text-sm ${notification.readAt ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>
                          {notification.title}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{notification.message}</span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{notification.type.replace(/_/g, ' ')}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-slate-100 px-3 py-2 text-center">
            <Link to="/notifications" className="text-xs font-medium text-brand-700 hover:underline">
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
