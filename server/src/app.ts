import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { config } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { createAuthLoginLimiter, createPasswordChangeLimiter, createPasswordResetLimiter, globalLimiter, staticLimiter } from './middleware/rateLimit.js';
import { requestContext, requestLogger } from './middleware/requestLogger.js';
import apiRouter from './routes/index.js';

export interface CreateAppOptions {
  loginRateLimit?: {
    windowMs?: number;
    max?: number;
  };
  passwordResetRateLimit?: {
    windowMs?: number;
    max?: number;
  };
  passwordChangeRateLimit?: {
    windowMs?: number;
    max?: number;
  };
}

/**
 * Builds the Express application. Options allow tests to create a fresh app
 * (with a fresh authentication limiter) per test case.
 */
export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  if (config.isProduction) {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');

  // --- 1. Compression: gzip for all responses >1KB ---
  app.use(
    compression({
      threshold: 1024,
      level: config.isProduction ? 6 : 1,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // --- 2. Security headers ---
  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              fontSrc: ["'self'"],
              connectSrc: ["'self'"],
              frameAncestors: ["'none'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // --- 3. Hide server version in response headers ---
  app.use((_req, res, next) => {
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    next();
  });

  // --- 4. Disable caching on all API responses ---
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  });

  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
    }),
  );

  // --- 5. Per-route body limits ---
  // Default: 100KB for most endpoints (products, categories, settings, etc.)
  app.use(express.json({ limit: '100kb' }));
  // Sales can be larger (many line items) — 512KB
  app.use('/api/sales', express.json({ limit: '512kb' }));

  app.use(cookieParser());
  app.use(requestContext());
  app.use(requestLogger());
  app.use(csrfProtection);

  // --- 6. Rate limits: tight for API, generous for static/health ---
  app.use('/api', globalLimiter);
  app.use('/api/auth/login', createAuthLoginLimiter(options.loginRateLimit));
  app.use('/api/auth/forgot-password', createPasswordResetLimiter(options.passwordResetRateLimit));
  app.use('/api/auth/reset-password', createPasswordResetLimiter(options.passwordResetRateLimit));
  app.use('/api/auth/change-password', createPasswordChangeLimiter(options.passwordChangeRateLimit));
  app.use('/api/auth/users', createPasswordChangeLimiter(options.passwordChangeRateLimit));
  app.use('/api', apiRouter);

  // Static-like endpoints get generous limits
  app.use('/api/health', staticLimiter);
  app.use('/api/dashboard', staticLimiter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp();
