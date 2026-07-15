import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { AppError } from '../http/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || req.path.startsWith('/api/internal/')) {
    next();
    return;
  }

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    next(new AppError(403, 'Origem da requisição não permitida.', 'INVALID_REQUEST_ORIGIN'));
    return;
  }

  const origin = req.get('origin');
  if (origin && origin !== config.WEB_ORIGIN) {
    next(new AppError(403, 'Origem da requisição não permitida.', 'INVALID_REQUEST_ORIGIN'));
    return;
  }

  const received = req.get('x-csrf-token');
  const expected = req.session.csrfToken;
  if (!received || !expected || !tokensMatch(expected, received)) {
    next(new AppError(403, 'Token CSRF inválido.', 'INVALID_CSRF_TOKEN'));
    return;
  }

  next();
}
