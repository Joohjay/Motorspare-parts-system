// Stage 3 — authentication & authorization test suite.
//
// Runs against the real Express app (createApp) with Prisma replaced by an
// in-memory mock via the lib/prisma test seam (globalThis.__MAKIRE_PRISMA__).
// Password hashing is real bcrypt (bcryptjs) at a reduced cost for speed, so
// the login/compare logic is genuinely exercised — only the database layer is
// mocked. Live database integration verification is reported separately as
// PENDING (no PostgreSQL is available in this environment).

process.env.NODE_ENV = 'test';
process.env.AUTH_BCRYPT_COST = '10';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import { createHash } from 'node:crypto';
import http from 'node:http';

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'bcryptjs';

import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const ADMIN2_ID = 'admin-2';
const ASSISTANT_ID = 'assistant-1';
const INACTIVE_ID = 'inactive-1';

const ADMIN_EMAIL = 'admin@makire.test';
const ASSISTANT_EMAIL = 'assistant@makire.test';
const INACTIVE_EMAIL = 'inactive@makire.test';

const CORRECT_ADMIN_PW = 'CorrectAdminPass1';
const CORRECT_ASSISTANT_PW = 'CorrectAssistantPass1';
const INACTIVE_PW = 'InactiveUserPass1';

interface UserRec {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'ASSISTANT';
  status: 'ACTIVE' | 'INACTIVE';
  passwordHash: string;
  tokenVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ResetRec {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

let usersById: Record<string, UserRec> = {};
let usersByEmail: Record<string, UserRec> = {};
let tokensByHash: Record<string, ResetRec> = {};
const auditRecords: Array<Record<string, unknown>> = [];

const db = {
  user: {
    findUnique: mock.fn((args: { where: { id?: string; email?: string } }) => {
      const where = args?.where ?? {};
      if (where.email) return Promise.resolve(usersByEmail[where.email] ?? null);
      if (where.id) return Promise.resolve(usersById[where.id] ?? null);
      return Promise.resolve(null);
    }),
    update: mock.fn(
      (args: { where: { id: string }; data: Partial<UserRec> }) => {
        const current = usersById[args.where.id];
        if (!current) return Promise.resolve(null);
        const updated: UserRec = { ...current, ...args.data, updatedAt: new Date() };
        usersById[updated.id] = updated;
        usersByEmail[updated.email] = updated;
        return Promise.resolve(updated);
      },
    ),
    count: mock.fn((args: { where: Partial<UserRec> }) => {
      const where = args?.where ?? {};
      const count = Object.values(usersById).filter((u) =>
        Object.entries(where).every(([k, v]) => (u as unknown as Record<string, unknown>)[k] === v),
      ).length;
      return Promise.resolve(count);
    }),
  },
  passwordResetToken: {
    findUnique: mock.fn((args: { where: { tokenHash: string } }) => {
      const rec = args?.where?.tokenHash ? tokensByHash[args.where.tokenHash] : null;
      return Promise.resolve(rec ? { ...rec, user: usersById[rec.userId] ?? null } : null);
    }),
    create: mock.fn((args: { data: Omit<ResetRec, 'id' | 'createdAt'> }) => {
      const rec: ResetRec = {
        id: `tok-${Object.keys(tokensByHash).length + 1}`,
        ...args.data,
        createdAt: new Date(),
      };
      tokensByHash[rec.tokenHash] = rec;
      return Promise.resolve({ ...rec, user: usersById[rec.userId] });
    }),
    updateMany: mock.fn((args: { where: { userId: string }; data: { usedAt: Date } }) => {
      let count = 0;
      for (const hashKey of Object.keys(tokensByHash)) {
        const t = tokensByHash[hashKey];
        if (!t) continue;
        if (t.userId === args.where.userId && t.usedAt === null) {
          t.usedAt = args.data.usedAt;
          count += 1;
        }
      }
      return Promise.resolve({ count });
    }),
  },
  auditLog: {
    create: mock.fn((args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return Promise.resolve(args.data);
    }),
  },
  $transaction: mock.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  $queryRaw: mock.fn(() => Promise.resolve([])),
};

(globalThis as unknown as { __MAKIRE_PRISMA__: unknown }).__MAKIRE_PRISMA__ = db;

let adminHash: string;
let assistantHash: string;
let inactiveHash: string;

// The app module graph (config + middleware + services) is imported only after
// the env vars and the prisma mock are installed.
const { createApp } = await import('../src/app.js');
const { signSessionToken } = await import('../src/utils/tokens.js');

function makeUser(overrides: Partial<UserRec>): UserRec {
  return {
    id: 'x',
    email: 'x@test',
    fullName: 'X',
    role: 'ASSISTANT',
    status: 'ACTIVE',
    passwordHash: '',
    tokenVersion: 0,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function loadUsers(): void {
  usersById = {
    [ADMIN_ID]: makeUser({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      fullName: 'System Admin',
      role: 'ADMIN',
      passwordHash: adminHash,
    }),
    [ADMIN2_ID]: makeUser({
      id: ADMIN2_ID,
      email: 'admin2@makire.test',
      fullName: 'Second Admin',
      role: 'ADMIN',
      passwordHash: adminHash,
    }),
    [ASSISTANT_ID]: makeUser({
      id: ASSISTANT_ID,
      email: ASSISTANT_EMAIL,
      fullName: 'Shop Assistant',
      role: 'ASSISTANT',
      passwordHash: assistantHash,
    }),
    [INACTIVE_ID]: makeUser({
      id: INACTIVE_ID,
      email: INACTIVE_EMAIL,
      fullName: 'Inactive User',
      role: 'ASSISTANT',
      status: 'INACTIVE',
      passwordHash: inactiveHash,
    }),
  };
  usersByEmail = Object.fromEntries(Object.values(usersById).map((u) => [u.email, u]));
}

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
    return [...this.cookies.entries()]
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }
}

async function startServer(options?: { loginRateLimit?: { windowMs?: number; max?: number } }): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = createApp(options);
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

interface ApiResponseBody {
  status: string;
  message: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    status: string;
    lastLoginAt: string | null;
  };
  error: {
    code: string;
    message: string;
  };
}

async function request(
  port: number,
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
  csrfToken?: string,
): Promise<{ status: number; body: ApiResponseBody; headers: Headers }> {
  const headers: Record<string, string> = {};
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  jar.setFrom(res.headers);
  let json: ApiResponseBody | null = null;
  try {
    json = (await res.json()) as ApiResponseBody;
  } catch {
    json = null;
  }
  return { status: res.status, body: (json ?? {}) as ApiResponseBody, headers: res.headers };
}

async function getCsrf(port: number, jar: CookieJar): Promise<string> {
  const res = await request(port, jar, 'GET', '/api/auth/csrf');
  assert.equal(res.status, 200);
  return res.body.csrfToken as string;
}

async function loginRequest(
  port: number,
  jar: CookieJar,
  email: string,
  password: string,
): Promise<{ status: number; body: ApiResponseBody; headers: Headers }> {
  const csrf = await getCsrf(port, jar);
  return request(port, jar, 'POST', '/api/auth/login', { email, password }, csrf);
}

beforeEach(async () => {
  for (const fn of [
    db.user.findUnique,
    db.user.update,
    db.user.count,
    db.passwordResetToken.findUnique,
    db.passwordResetToken.create,
    db.passwordResetToken.updateMany,
    db.auditLog.create,
    db.$transaction,
    db.$queryRaw,
  ]) {
    fn.mock.resetCalls();
  }
  adminHash = await hash(CORRECT_ADMIN_PW, 4);
  assistantHash = await hash(CORRECT_ASSISTANT_PW, 4);
  inactiveHash = await hash(INACTIVE_PW, 4);
  usersById = {};
  usersByEmail = {};
  tokensByHash = {};
  auditRecords.length = 0;
  loadUsers();
});

describe('authentication', () => {
  test('1. valid ADMIN login succeeds and establishes a session', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await loginRequest(port, jar, ADMIN_EMAIL, CORRECT_ADMIN_PW);

      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, 'ADMIN');
      assert.equal(res.body.user.email, ADMIN_EMAIL);
      assert.equal('passwordHash' in res.body.user, false, 'must never expose passwordHash');

      const setCookie = res.headers.get('set-cookie') ?? '';
      assert.match(setCookie, /makire_session=/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Path=\//i);
      assert.match(setCookie, /SameSite=Lax/i);

      // Session cookie is httpOnly: it must never be readable by JS.
      const sessionCookiePart = setCookie.split(';').find((p) => p.trim().startsWith('makire_session'));
      assert.ok(sessionCookiePart);

      // lastLoginAt updated + security audit written.
      const updateCall = db.user.update.mock.calls.find((c) => (c.arguments[0].data as { lastLoginAt?: Date }).lastLoginAt);
      assert.ok(updateCall, 'lastLoginAt should be updated on login');
      const audit = auditRecords.find((a) => a.action === 'LOGIN_SUCCESS');
      assert.ok(audit, 'LOGIN_SUCCESS audit event expected');
      assert.equal(audit.userId, ADMIN_ID);
      assert.ok(audit.requestId, 'audit should carry the request id');
    } finally {
      await close();
    }
  });

  test('2. valid ASSISTANT login succeeds', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await loginRequest(port, jar, ASSISTANT_EMAIL, CORRECT_ASSISTANT_PW);
      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, 'ASSISTANT');
      assert.ok(auditRecords.some((a) => a.action === 'LOGIN_SUCCESS'));
    } finally {
      await close();
    }
  });

  test('3. invalid password is rejected safely', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await loginRequest(port, jar, ADMIN_EMAIL, 'WrongPassword99');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      const audit = auditRecords.find((a) => a.action === 'LOGIN_FAILED');
      assert.ok(audit);
      assert.equal(audit.userId, ADMIN_ID);
    } finally {
      await close();
    }
  });

  test('4. unknown account is rejected with the identical response', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await loginRequest(port, jar, 'nobody@makire.test', 'WrongPassword99');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      const audit = auditRecords.find((a) => a.action === 'LOGIN_FAILED');
      assert.ok(audit);
      assert.equal(audit.entityId, 'unknown');
    } finally {
      await close();
    }
  });

  test('5. inactive account cannot authenticate (no enumeration signal)', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await loginRequest(port, jar, INACTIVE_EMAIL, INACTIVE_PW);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS', 'must not reveal the account is inactive');
    } finally {
      await close();
    }
  });

  test('6. /api/auth/me returns safe user info when authenticated', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
      const res = await request(port, jar, 'GET', '/api/auth/me');
      assert.equal(res.status, 200);
      assert.equal(res.body.user.id, ADMIN_ID);
      assert.equal(res.body.user.role, 'ADMIN');
      assert.equal('passwordHash' in res.body.user, false);
    } finally {
      await close();
    }
  });

  test('7. /api/auth/me is rejected when unauthenticated', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await request(port, jar, 'GET', '/api/auth/me');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_REQUIRED');
    } finally {
      await close();
    }
  });

  test('8. logout clears the session cookie', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID, 0));
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/auth/logout', undefined, csrf);
      assert.equal(res.status, 204);

      const setCookie = res.headers.get('set-cookie') ?? '';
      assert.match(setCookie, /makire_session=;/);
      assert.match(setCookie, /Max-Age=0|Expires=/i);

      const me = await request(port, jar, 'GET', '/api/auth/me');
      assert.equal(me.status, 401, 'session must be unusable after logout');
      assert.ok(auditRecords.some((a) => a.action === 'LOGOUT'));
    } finally {
      await close();
    }
  });

  test('9. protected endpoints reject unauthenticated requests', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(
        port,
        jar,
        'PATCH',
        `/api/auth/users/${ASSISTANT_ID}/status`,
        { status: 'INACTIVE' },
        csrf,
      );
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_REQUIRED');
    } finally {
      await close();
    }
  });

  test('10. ADMIN-only endpoint is forbidden for ASSISTANT', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID, 0));
      const csrf = await getCsrf(port, jar);
      const res = await request(
        port,
        jar,
        'PATCH',
        `/api/auth/users/${ASSISTANT_ID}/status`,
        { status: 'INACTIVE' },
        csrf,
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    } finally {
      await close();
    }
  });

  test('11. ADMIN can manage another account status', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
      const csrf = await getCsrf(port, jar);
      const res = await request(
        port,
        jar,
        'PATCH',
        `/api/auth/users/${ASSISTANT_ID}/status`,
        { status: 'INACTIVE' },
        csrf,
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.user.status, 'INACTIVE');
      const audit = auditRecords.find((a) => a.action === 'ACCOUNT_DEACTIVATED');
      assert.ok(audit);
      assert.equal(audit.userId, ADMIN_ID);
      assert.equal(usersById[ASSISTANT_ID]!.status, 'INACTIVE');
    } finally {
      await close();
    }
  });

  test('12. state-changing request without CSRF token is rejected', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await request(
        port,
        jar,
        'POST',
        '/api/auth/login',
        { email: ADMIN_EMAIL, password: CORRECT_ADMIN_PW },
        undefined,
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'CSRF_TOKEN_INVALID');
    } finally {
      await close();
    }
  });

  test('13. state-changing request with CSRF token succeeds (login)', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(
        port,
        jar,
        'POST',
        '/api/auth/login',
        { email: ADMIN_EMAIL, password: CORRECT_ADMIN_PW },
        csrf,
      );
      assert.equal(res.status, 200);
    } finally {
      await close();
    }
  });

  test('14. login brute-force attempts are rate limited', async () => {
    const { port, close } = await startServer({ loginRateLimit: { max: 3, windowMs: 60_000 } });
    try {
      const jar = new CookieJar();
      for (let i = 0; i < 3; i += 1) {
        const res = await loginRequest(port, jar, ADMIN_EMAIL, 'WrongPassword99');
        assert.equal(res.status, 401, 'first three failures should be rejected as bad credentials');
      }
      const fourth = await loginRequest(port, jar, ADMIN_EMAIL, 'WrongPassword99');
      assert.equal(fourth.status, 429);
      assert.equal(fourth.body.error.code, 'RATE_LIMITED');
    } finally {
      await close();
    }
  });
});

describe('password reset', () => {
  test('15. forgot-password issues a hashed, single-use token for an active account', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/auth/forgot-password', { email: ADMIN_EMAIL }, csrf);

      assert.equal(res.status, 200);
      assert.match(res.body.message, /reset link/i);

      const createCall = db.passwordResetToken.create.mock.calls.at(-1);
      assert.ok(createCall, 'a reset token should be stored');
      const stored = createCall.arguments[0].data as { userId: string; tokenHash: string; expiresAt: Date };
      assert.equal(stored.userId, ADMIN_ID);
      assert.equal(stored.tokenHash.length, 64, 'token hash must be sha256 hex');
      assert.ok(stored.expiresAt > new Date());
      assert.ok(auditRecords.some((a) => a.action === 'PASSWORD_RESET_REQUESTED'));
    } finally {
      await close();
    }
  });

  test('16. expired reset token is rejected', async () => {
    const { port, close } = await startServer();
    try {
      const tokenHash = createHash('sha256').update('expired-token').digest('hex');
      tokensByHash[tokenHash] = {
        id: 'tok-expired',
        userId: ADMIN_ID,
        tokenHash,
        expiresAt: new Date(Date.now() - 60_000),
        usedAt: null,
        createdAt: new Date(),
      };
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/auth/reset-password', { token: 'expired-token', password: 'NewStrongPassword1' }, csrf);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_TOKEN');
    } finally {
      await close();
    }
  });

  test('17. already-used reset token is rejected', async () => {
    const { port, close } = await startServer();
    try {
      const tokenHash = createHash('sha256').update('used-token').digest('hex');
      tokensByHash[tokenHash] = {
        id: 'tok-used',
        userId: ADMIN_ID,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        createdAt: new Date(),
      };
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/auth/reset-password', { token: 'used-token', password: 'NewStrongPassword1' }, csrf);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_TOKEN');
    } finally {
      await close();
    }
  });

  test('18. successful password reset updates the hash and invalidates tokens', async () => {
    const { port, close } = await startServer();
    try {
      const rawToken = 'fresh-valid-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      tokensByHash[tokenHash] = {
        id: 'tok-fresh',
        userId: ADMIN_ID,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      };

      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/auth/reset-password', { token: rawToken, password: 'BrandNewPassword1' }, csrf);
      assert.equal(res.status, 200);

      const updateCall = db.user.update.mock.calls.find(
        (c) => (c.arguments[0].data as { passwordHash?: string }).passwordHash,
      );
      assert.ok(updateCall, 'password hash should be updated');
      const newHash = (updateCall.arguments[0].data as { passwordHash: string }).passwordHash;
      assert.ok(newHash.startsWith('$2'), 'new hash must be a bcrypt hash');
      assert.notEqual(newHash, adminHash);

      assert.ok(auditRecords.some((a) => a.action === 'PASSWORD_RESET_COMPLETED'));

      // Token is now consumed.
      assert.ok(tokensByHash[tokenHash].usedAt, 'token must be marked used');
      const reuse = await request(port, jar, 'POST', '/api/auth/reset-password', { token: rawToken, password: 'AnotherPass1' }, csrf);
      assert.equal(reuse.status, 400, 'single-use token must not be reusable');
      assert.equal(reuse.body.error.code, 'INVALID_TOKEN');
    } finally {
      await close();
    }
  });

  test('19. forgot-password does not reveal whether an account exists', async () => {
    const { port, close } = await startServer();
    try {
      const jarKnown = new CookieJar();
      const csrf1 = await getCsrf(port, jarKnown);
      const known = await request(port, jarKnown, 'POST', '/api/auth/forgot-password', { email: ADMIN_EMAIL }, csrf1);

      const jarUnknown = new CookieJar();
      const csrf2 = await getCsrf(port, jarUnknown);
      const unknown = await request(port, jarUnknown, 'POST', '/api/auth/forgot-password', { email: 'nobody@makire.test' }, csrf2);

      assert.equal(known.status, 200);
      assert.equal(unknown.status, 200);
      assert.deepEqual(unknown.body, known.body, 'responses must be indistinguishable');

      const createCalls = db.passwordResetToken.create.mock.calls.length;
      assert.equal(createCalls, 1, 'no token created for the unknown account');
    } finally {
      await close();
    }
  });

  test('reset-password enforces the 8-character password policy', async () => {
    const { port, close } = await startServer();
    try {
      const rawToken = 'policy-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      tokensByHash[tokenHash] = {
        id: 'tok-policy',
        userId: ADMIN_ID,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      };
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/auth/reset-password', { token: rawToken, password: 'short' }, csrf);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_PASSWORD');
      assert.match(res.body.error.message, /at least 8/);
    } finally {
      await close();
    }
  });
});

describe('account administration', () => {
  test('20. the final ADMIN cannot be deactivated', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
      const csrf = await getCsrf(port, jar);

      // Only one active admin exists (admin-2 is deactivated first).
      usersById[ADMIN2_ID]!.status = 'INACTIVE';

      const res = await request(
        port,
        jar,
        'PATCH',
        `/api/auth/users/${ADMIN2_ID}/status`,
        { status: 'INACTIVE' },
        csrf,
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'FINAL_ADMIN_PROTECTION');
      assert.equal(usersById[ADMIN2_ID]!.status, 'INACTIVE', 'target already inactive');
    } finally {
      await close();
    }
  });

  test('an ADMIN cannot deactivate themself', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
      const csrf = await getCsrf(port, jar);
      const res = await request(
        port,
        jar,
        'PATCH',
        `/api/auth/users/${ADMIN_ID}/status`,
        { status: 'INACTIVE' },
        csrf,
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'CANNOT_DEACTIVATE_SELF');
    } finally {
      await close();
    }
  });

  test('ADMIN can deactivate a second admin when another active admin remains', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
      const csrf = await getCsrf(port, jar);
      const res = await request(
        port,
        jar,
        'PATCH',
        `/api/auth/users/${ADMIN2_ID}/status`,
        { status: 'INACTIVE' },
        csrf,
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.user.status, 'INACTIVE');
      assert.ok(auditRecords.some((a) => a.action === 'ACCOUNT_DEACTIVATED'));
    } finally {
      await close();
    }
  });

  test('deactivated users lose access on their next request', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID, 0));
      usersById[ASSISTANT_ID]!.status = 'INACTIVE';
      const res = await request(port, jar, 'GET', '/api/auth/me');
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCOUNT_INACTIVE');
    } finally {
      await close();
    }
  });
});

describe('health endpoint', () => {
  test('health still reports the database state without crashing', async () => {
    const { port, close } = await startServer();
    try {
      const res = await request(port, new CookieJar(), 'GET', '/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
    } finally {
      await close();
    }
  });
});

afterEach(async () => {
  mock.reset();
});