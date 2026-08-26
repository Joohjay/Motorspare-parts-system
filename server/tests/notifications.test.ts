// Stage 9 — notifications service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const ASSISTANT_ID = 'assistant-1';

interface NotifRec {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

let notifications: NotifRec[] = [];
let notifIdCounter = 1;

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      if (args.where?.id === ASSISTANT_ID) return { id: ASSISTANT_ID, email: 'assistant@test', fullName: 'Assistant', role: 'ASSISTANT', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async () => ({})),
    findMany: mock.fn(async (args?: { where?: Record<string, unknown> }) => {
      const users = [
        { id: ADMIN_ID }, { id: ASSISTANT_ID },
      ];
      return users;
    }),
  },
  notification: {
    count: mock.fn(async (args: { where: { userId?: string; readAt?: null } }) => {
      return notifications.filter((n) => {
        if (args.where.userId && n.userId !== args.where.userId) return false;
        if (args.where.readAt === null && n.readAt !== null) return false;
        return true;
      }).length;
    }),
    findMany: mock.fn(async (args: { where: { userId?: string; readAt?: null }; skip?: number; take?: number }) => {
      const filtered = notifications.filter((n) => {
        if (args.where.userId && n.userId !== args.where.userId) return false;
        if (args.where.readAt === null && n.readAt !== null) return false;
        return true;
      });
      return filtered.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 25));
    }),
    findUnique: mock.fn(async (args: { where: { id: string } }) => {
      return notifications.find((n) => n.id === args.where.id) ?? null;
    }),
    findFirst: mock.fn(async (args: { where: { userId: string; type: string; readAt: null; data: { path: string; equals: string } } }) => {
      return notifications.find((n) =>
        n.userId === args.where.userId &&
        n.type === args.where.type &&
        n.readAt === null &&
        n.data[args.where.data.path as string] === args.where.data.equals,
      ) ?? null;
    }),
    create: mock.fn(async (args: { data: Omit<NotifRec, 'id' | 'createdAt'> }) => {
      const rec: NotifRec = { id: `notif-${notifIdCounter++}`, ...args.data, createdAt: new Date() } as NotifRec;
      notifications.push(rec);
      return rec;
    }),
    update: mock.fn(async (args: { where: { id: string }; data: { readAt: Date } }) => {
      const notif = notifications.find((n) => n.id === args.where.id);
      if (notif) notif.readAt = args.data.readAt;
      return notif;
    }),
    updateMany: mock.fn(async (args: { where: { userId: string; readAt: null }; data: { readAt: Date } }) => {
      let count = 0;
      for (const n of notifications) {
        if (n.userId === args.where.userId && n.readAt === null) {
          n.readAt = args.data.readAt;
          count++;
        }
      }
      return { count };
    }),
  },
  product: {
    findMany: mock.fn(async () => []),
  },
  inventory: {
    findMany: mock.fn(async () => []),
  },
  auditLog: {
    create: mock.fn(async () => ({})),
  },
  $queryRaw: mock.fn(async () => []),
  $transaction: mock.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

(globalThis as unknown as { __MAKIRE_PRISMA__: unknown }).__MAKIRE_PRISMA__ = db;

const { createApp } = await import('../src/app.js');
const { signSessionToken } = await import('../src/utils/tokens.js');

class CookieJar {
  cookies = new Map<string, string>();
  setFrom(headers: Headers): void {
    const setCookies = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
    const raw = Array.isArray(setCookies) ? setCookies : [headers.get('set-cookie')].filter(Boolean) as string[];
    for (const sc of raw) {
      const pair = sc.split(';')[0];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies.entries()].filter(([, v]) => v.length > 0).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function request(
  port: number, jar: CookieJar, method: string, path: string, body?: unknown, csrfToken?: string,
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const headers: Record<string, string> = {};
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
  });
  jar.setFrom(res.headers);
  let json: Record<string, unknown> | null = null;
  try { json = (await res.json()) as Record<string, unknown>; } catch { json = null; }
  return { status: res.status, body: (json ?? {}) as Record<string, unknown>, headers: res.headers };
}

async function getCsrf(port: number, jar: CookieJar): Promise<string> {
  const res = await request(port, jar, 'GET', '/api/auth/csrf');
  assert.equal(res.status, 200);
  return (res.body as { csrfToken: string }).csrfToken;
}

function adminJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
  return jar;
}

function assistantJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID, 0));
  return jar;
}

beforeEach(() => {
  for (const fn of [
    db.user.findUnique, db.user.update, db.user.findMany,
    db.notification.count, db.notification.findMany, db.notification.findUnique,
    db.notification.findFirst, db.notification.create, db.notification.update, db.notification.updateMany,
    db.product.findMany, db.inventory.findMany, db.auditLog.create,
  ]) {
    fn.mock.resetCalls();
  }
  notifications = [];
  notifIdCounter = 1;
});

afterEach(() => { mock.reset(); });

describe('notifications', () => {
  test('getUnreadCount returns 0 when no notifications exist', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/notifications/unread-count');
      assert.equal(res.status, 200);
      assert.equal((res.body as { unreadCount: number }).unreadCount, 0);
    } finally { await close(); }
  });

  test('getUnreadCount returns correct count for user', async () => {
    notifications.push(
      { id: 'n1', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: { productId: 'p1' }, readAt: null, createdAt: new Date() },
      { id: 'n2', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: { productId: 'p2' }, readAt: null, createdAt: new Date() },
      { id: 'n3', userId: ASSISTANT_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: { productId: 'p1' }, readAt: null, createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/notifications/unread-count');
      assert.equal(res.status, 200);
      assert.equal((res.body as { unreadCount: number }).unreadCount, 2);
    } finally { await close(); }
  });

  test('listNotifications returns paginated notifications for the user', async () => {
    notifications.push(
      { id: 'n1', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
      { id: 'n2', userId: ASSISTANT_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/notifications?pageSize=10');
      assert.equal(res.status, 200);
      const body = res.body as { items: NotifRec[]; pagination: { totalItems: number } };
      assert.equal(body.items.length, 1);
      assert.equal(body.pagination.totalItems, 1);
      assert.equal(body.items[0].id, 'n1');
    } finally { await close(); }
  });

  test('listNotifications with unreadOnly=true filters read notifications', async () => {
    notifications.push(
      { id: 'n1', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
      { id: 'n2', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: new Date(), createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/notifications?unreadOnly=true');
      assert.equal(res.status, 200);
      const body = res.body as { items: NotifRec[]; pagination: { totalItems: number } };
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0].id, 'n1');
    } finally { await close(); }
  });

  test('markNotificationRead marks a notification as read', async () => {
    notifications.push(
      { id: 'n1', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/notifications/n1/read', undefined, csrf);
      assert.equal(res.status, 200);
      assert.ok(notifications[0].readAt);
    } finally { await close(); }
  });

  test('markNotificationRead returns existing if already read (idempotent)', async () => {
    const readDate = new Date('2026-01-01T00:00:00Z');
    notifications.push(
      { id: 'n1', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: readDate, createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/notifications/n1/read', undefined, csrf);
      assert.equal(res.status, 200);
    } finally { await close(); }
  });

  test('markNotificationRead rejects notification belonging to another user', async () => {
    notifications.push(
      { id: 'n1', userId: ASSISTANT_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/notifications/n1/read', undefined, csrf);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('markAllNotificationsRead marks all user unread notifications as read', async () => {
    notifications.push(
      { id: 'n1', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
      { id: 'n2', userId: ADMIN_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
      { id: 'n3', userId: ASSISTANT_ID, type: 'OUT_OF_STOCK', title: 'OOS', message: 'msg', data: {}, readAt: null, createdAt: new Date() },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/notifications/mark-all-read', undefined, csrf);
      assert.equal(res.status, 200);
      assert.equal((res.body as { updatedCount: number }).updatedCount, 2);
      assert.ok(notifications[0].readAt);
      assert.ok(notifications[1].readAt);
      assert.ok(!notifications[2].readAt, 'other user notification should not be marked');
    } finally { await close(); }
  });

  test('unauthenticated user cannot access notifications', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await request(port, jar, 'GET', '/api/notifications/unread-count');
      assert.equal(res.status, 401);
    } finally { await close(); }
  });
});
