import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import morgan from 'morgan';

import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Assigns every request a stable ID, echoed back as X-Request-Id and reused in
// logs and error responses so a single request is traceable end to end.
export function requestContext(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (req, res, next) => {
    const id = randomUUID();
    req.headers['x-request-id'] = id;
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

export function requestLogger(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  if (config.isDevelopment) {
    morgan.token('request-id', (req: Request) => {
      const value = req.headers['x-request-id'];
      return Array.isArray(value) ? value[0] : value;
    });
    return morgan(':request-id :method :url :status :response-time ms');
  }

  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('http_request', {
        requestId: res.locals.requestId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userAgent: req.get('user-agent'),
        ip: req.ip,
      });
    });
    next();
  };
}