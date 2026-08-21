import { appConfig } from '@/config/env';

import type { ApiErrorBody } from '@/types/api';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Authentication is cookie-based (httpOnly session cookie) — nothing is ever
 * stored in localStorage/sessionStorage. A CSRF token is a per-session nonce
 * kept only in memory and echoed in the X-CSRF-Token header on every
 * state-changing request (double-submit cookie pattern).
 */
let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${appConfig.apiUrl}/auth/csrf`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiClientError(res.status, 'CSRF_FETCH_FAILED', 'Could not obtain a CSRF token');
  }
  const body = (await res.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  return fetchCsrfToken();
}

/**
 * Invoked whenever any API call receives a 401 so the authentication state can
 * be cleared and the user redirected to the login page.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Thin typed API client. Credentials are included so httpOnly authentication
 * cookies are sent automatically; state-changing requests carry the CSRF
 * header.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (!SAFE_METHODS.has(method)) {
    headers.set('X-CSRF-Token', await ensureCsrfToken());
  }
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${appConfig.apiUrl}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = undefined;
    }
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? `Request failed with status ${res.status}`,
      body?.error?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}