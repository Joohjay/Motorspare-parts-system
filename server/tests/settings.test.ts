// Stage 9 — settings service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const ASSISTANT_ID = 'assistant-1';

interface SettingRec {
  key: string;
  value: string;
  dataType: string;
}

let settingsStore: Record<string, SettingRec> = {};
const auditRecords: Array<Record<string, unknown>> = [];

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string; email?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      if (args.where?.id === ASSISTANT_ID) return { id: ASSISTANT_ID, email: 'assistant@test', fullName: 'Assistant', role: 'ASSISTANT', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id })),
  },
  setting: {
    findMany: mock.fn(async (args?: { where?: { key?: { in: string[] } } }) => {
      const keys = args?.where?.key?.in ?? [];
      return keys.map((k) => settingsStore[k]).filter(Boolean);
    }),
    findUnique: mock.fn(async (args: { where: { key: string } }) => {
      return settingsStore[args.where.key] ?? null;
    }),
    upsert: mock.fn(async (args: { where: { key: string }; create: SettingRec; update: { value: string } }) => {
      settingsStore[args.where.key] = { ...args.create, value: args.update.value };
      return settingsStore[args.where.key];
    }),
  },
  auditLog: {
    create: mock.fn(async (args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return args.data;
    }),
  },
  $transaction: mock.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
  $queryRaw: mock.fn(async () => []),
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
  port: number,
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
  csrfToken?: string,
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

function resetStores(): void {
  settingsStore = {};
  auditRecords.length = 0;
}

beforeEach(() => {
  for (const fn of [db.user.findUnique, db.user.update, db.setting.findMany, db.setting.findUnique, db.setting.upsert, db.auditLog.create, db.$transaction]) {
    fn.mock.resetCalls();
  }
  resetStores();
});

afterEach(() => { mock.reset(); });

describe('settings', () => {
  test('getPublicSettings returns defaults when no settings exist', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/settings');
      assert.equal(res.status, 200);
      const settings = res.body.settings as Record<string, string>;
      assert.equal(settings['business.name'], 'JM SPAREPARTS');
      assert.equal(settings['business.currency'], 'TZS');
      assert.equal(settings['business.timezone'], 'Africa/Nairobi');
    } finally { await close(); }
  });

  test('getPublicSettings returns stored values over defaults', async () => {
    settingsStore['business.name'] = { key: 'business.name', value: 'Custom Name', dataType: 'STRING' };
    settingsStore['business.phone'] = { key: 'business.phone', value: '+255700000000', dataType: 'STRING' };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/settings');
      assert.equal(res.status, 200);
      const settings = res.body.settings as Record<string, string>;
      assert.equal(settings['business.name'], 'Custom Name');
      assert.equal(settings['business.phone'], '+255700000000');
    } finally { await close(); }
  });

  test('updateSettings persists changes and creates audit log', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PUT', '/api/settings', {
        'business.name': 'New Shop Name',
        'business.phone': '+255123456789',
      }, csrf);
      assert.equal(res.status, 200);
      const settings = res.body.settings as Record<string, string>;
      assert.equal(settings['business.name'], 'New Shop Name');
      assert.equal(settings['business.phone'], '+255123456789');
      assert.ok(settingsStore['business.name']!.value === 'New Shop Name');
      assert.ok(settingsStore['business.phone']!.value === '+255123456789');
      assert.ok(auditRecords.some((a) => a.action === 'SETTINGS_UPDATED'));
    } finally { await close(); }
  });

  test('updateSettings rejects non-whitelisted keys (Zod validation)', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PUT', '/api/settings', {
        'business.name': 'OK',
        'secret.key': 'should be dropped',
        'database.url': 'also dropped',
      }, csrf);
      assert.equal(res.status, 400, 'Zod rejects non-whitelisted keys at the controller level');
    } finally { await close(); }
  });

  test('updateSettings skips unchanged values (no audit when nothing changes)', async () => {
    settingsStore['business.name'] = { key: 'business.name', value: 'Same Name', dataType: 'STRING' };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PUT', '/api/settings', {
        'business.name': 'Same Name',
      }, csrf);
      assert.equal(res.status, 200);
      assert.ok(!auditRecords.some((a) => a.action === 'SETTINGS_UPDATED'), 'no audit when nothing changed');
    } finally { await close(); }
  });

  test('updateSettings requires admin role', async () => {
    const { port, close } = await startServer();
    try {
      const jar = assistantJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PUT', '/api/settings', {
        'business.name': 'Assistant Update',
      }, csrf);
      assert.equal(res.status, 403, 'assistant cannot update settings');
    } finally { await close(); }
  });

  test('updateSettings rejects empty body', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PUT', '/api/settings', {}, csrf);
      assert.equal(res.status, 400);
      assert.equal((res.body.error as { code: string }).code, 'INVALID_REQUEST');
    } finally { await close(); }
  });

  test('unauthenticated user cannot read settings (requires auth)', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await request(port, jar, 'GET', '/api/settings');
      assert.equal(res.status, 401, 'settings endpoint requires authentication');
    } finally { await close(); }
  });

  test('unauthenticated user cannot update settings', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PUT', '/api/settings', { 'business.name': 'Nope' }, csrf);
      assert.equal(res.status, 401);
    } finally { await close(); }
  });
});
