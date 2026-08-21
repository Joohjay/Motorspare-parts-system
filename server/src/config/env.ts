import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().optional(),
  CLIENT_URL: z.string().url().optional(),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required. See server/.env.example'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  // Session cookie name (httpOnly auth cookie). 
  AUTH_COOKIE_NAME: z.string().min(1).default('makire_session'),
  // Bcrypt cost factor for password hashing. 12 is the default production cost.
  AUTH_BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  // Login brute-force limiter window (ms) and max allowed failures per window.
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Password reset token lifetime (ms).
  AUTH_RESET_TOKEN_TTL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  // Base URL used to build password reset links (dev mode only logs it).
  AUTH_RESET_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  console.error(
    'Invalid environment configuration. Fix the following and restart:\n' +
      issues,
  );
  process.exit(1);
}

const PLACEHOLDER_JWT = 'change-me-to-a-long-random-secret-at-least-32-chars';

function isPlaceholderSecret(value: string): boolean {
  if (value === PLACEHOLDER_JWT) return true;
  return /^(change-me|changeme|secret|your-)/i.test(value);
}

const clientOrigin =
  parsed.data.CLIENT_ORIGIN ?? parsed.data.CLIENT_URL ?? 'http://localhost:5173';

function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) return 8 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * multiplier;
}

if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (isPlaceholderSecret(parsed.data.JWT_SECRET)) {
    problems.push(
      'JWT_SECRET must be a unique random value in production (generate with: openssl rand -hex 64)',
    );
  }
  if (clientOrigin.startsWith('http://')) {
    problems.push('CLIENT_ORIGIN must use https:// in production');
  }
  if (problems.length > 0) {
    console.error(
      'Invalid production environment configuration. Fix the following and restart:\n' +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    process.exit(1);
  }
}

export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  clientOrigin,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  jwt: {
    secret: parsed.data.JWT_SECRET,
    expiresIn: parsed.data.JWT_EXPIRES_IN,
  },
  auth: {
    sessionCookieName: parsed.data.AUTH_COOKIE_NAME,
    sessionSecret: parsed.data.JWT_SECRET,
    sessionTtlMs: parseDuration(parsed.data.JWT_EXPIRES_IN),
    bcryptCost: parsed.data.AUTH_BCRYPT_COST,
    loginRateLimit: {
      windowMs: parsed.data.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
      max: parsed.data.AUTH_LOGIN_RATE_LIMIT_MAX,
    },
    resetTokenTtlMs: parsed.data.AUTH_RESET_TOKEN_TTL_MS,
    resetUrl: parsed.data.AUTH_RESET_URL ?? `${clientOrigin}/reset-password`,
  },
} as const;