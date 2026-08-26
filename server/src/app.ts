import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { config } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { createAuthLoginLimiter, createPasswordChangeLimiter, createPasswordResetLimiter, globalLimiter } from './middleware/rateLimit.js';
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

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestContext());
  app.use(requestLogger());
  app.use(csrfProtection);
  app.use('/api', globalLimiter);
  app.use('/api/auth/login', createAuthLoginLimiter(options.loginRateLimit));
  app.use('/api/auth/forgot-password', createPasswordResetLimiter(options.passwordResetRateLimit));
  app.use('/api/auth/reset-password', createPasswordResetLimiter(options.passwordResetRateLimit));
  app.use('/api/auth/change-password', createPasswordChangeLimiter(options.passwordChangeRateLimit));
  app.use('/api/auth/users', createPasswordChangeLimiter(options.passwordChangeRateLimit));
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp();