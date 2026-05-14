import type { NextFunction, Request, Response } from 'express';

interface HttpErrorOptions {
  fieldErrors?: unknown[];
  details?: unknown;
}

export class HttpError extends Error {
  status: number;
  code: string;
  fieldErrors: unknown[];
  details: unknown;

  constructor(status: number, code: string, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors || [];
    this.details = options.details;
  }
}

export function badRequest(code: string, message: string, fieldErrors: unknown[] = []) {
  return new HttpError(400, code, message, { fieldErrors });
}

export function unauthorized(code = 'UNAUTHORIZED', message = 'Unauthorized.') {
  return new HttpError(401, code, message);
}

export function forbidden(code = 'FORBIDDEN', message = 'Forbidden.') {
  return new HttpError(403, code, message);
}

export function notFound(code = 'NOT_FOUND', message = 'Not found.') {
  return new HttpError(404, code, message);
}

export function conflict(code: string, message: string, details?: unknown) {
  return new HttpError(409, code, message, { details });
}

export function rateLimited(code: string, message: string) {
  return new HttpError(429, code, message);
}

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
