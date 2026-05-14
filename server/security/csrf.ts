import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../http/errors.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const defaultAllowedOrigins = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function configuredOrigins() {
  const raw = process.env.APP_ORIGIN;
  if (!raw) {
    return defaultAllowedOrigins;
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function requestOrigin(req: Request): string | null {
  const origin = req.get('Origin');
  if (origin) {
    return origin;
  }

  const referer = req.get('Referer');
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function csrfProtection({ exemptPaths = [] }: { exemptPaths?: string[] } = {}) {
  const exempt = new Set(exemptPaths);

  return (req: Request, _res: Response, next: NextFunction) => {
    if (safeMethods.has(req.method) || exempt.has(req.path) || !req.session?.userId) {
      next();
      return;
    }

    const expectedToken = req.session.csrfToken;
    const actualToken = req.get('X-CSRF-Token');
    if (!expectedToken || actualToken !== expectedToken) {
      next(forbidden('CSRF_FAILED', 'Invalid or missing CSRF token.'));
      return;
    }

    const origin = requestOrigin(req);
    if (!origin || !configuredOrigins().includes(origin)) {
      next(forbidden('ORIGIN_FAILED', 'Invalid or missing request origin.'));
      return;
    }

    next();
  };
}
