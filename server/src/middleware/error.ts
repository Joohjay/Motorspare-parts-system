import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

import { logger } from '../lib/logger.js';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }
}

export function notFoundHandler(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(ApiError.notFound('Requested endpoint does not exist'));
}

function isPrismaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return err.constructor?.name?.includes('Prisma') ?? false;
}

function prismaErrorCode(err: unknown): string | null {
  if (!isPrismaError(err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

// Maps Prisma error codes to stable HTTP responses so clients get accurate
// status codes instead of a blanket 503. Internal details are never leaked.
function prismaErrorResponse(
  err: unknown,
  fallback: { statusCode: number; code: string; message: string },
): { statusCode: number; code: string; message: string } {
  const code = prismaErrorCode(err);
  switch (code) {
    case 'P2000':
      return {
        statusCode: 400,
        code: 'INVALID_VALUE',
        message: 'A provided value is too long for its field',
      };
    case 'P2002':
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This record already exists',
      };
    case 'P2003':
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This record is referenced by other data',
      };
    case 'P2025':
      return {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'The requested record was not found',
      };
    case 'P2014':
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This change would break related data',
      };
    default:
      return fallback;
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
    } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'INVALID_REQUEST';
    message = 'Invalid request data';
    details = err.flatten();
    logger.warn('[error] zod validation', { path: _req.path, issues: JSON.stringify(err.issues) });
  
  } else if (err instanceof SyntaxError) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body';
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    code = 'INVALID_REQUEST';
    message = 'Invalid request data';
    logger.error('[error] prisma validation', { message: (err as Error).message });
  } else if (isPrismaError(err)) {
    const mapped = prismaErrorResponse(err, {
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message:
        'The database is temporarily unavailable. Please try again in a moment.',
    });
    statusCode = mapped.statusCode;
    code = mapped.code;
    message = mapped.message;
    logger.error('[error] database error', { message: (err as Error).message });
  }

  if (statusCode >= 500 && !isPrismaError(err)) {
    logger.error('[error]', {
      requestId: String(res.getHeader('X-Request-Id') ?? ''),
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  const body: { error: Record<string, unknown> } = {
    error: { code, message },
  };

  if (details !== undefined) {
    body.error.details = details;
  }

  res.status(statusCode).json(body);
}