import crypto from 'node:crypto';
import type { Request } from 'express';

export function regenerateSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function destroySession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function ensureCsrfToken(req: Request) {
  req.session.csrfToken ??= createCsrfToken();
  return req.session.csrfToken;
}
