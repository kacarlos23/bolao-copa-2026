import type { Request } from 'express';
import { config } from '../config.js';

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function configuredOrigins() {
  return [config.WEB_ORIGIN, config.PRODUCTION_WEB_URL, ...config.WEB_ORIGINS.split(',')]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
}

export function isConfiguredWebOrigin(origin: string) {
  const normalizedOrigin = normalizeOrigin(origin);
  return normalizedOrigin ? configuredOrigins().includes(normalizedOrigin) : false;
}

export function requestOrigin(req: Request) {
  const host = req.get('host');
  if (!host) return null;
  return `${req.protocol}://${host}`;
}

export function isTrustedStateChangingOrigin(req: Request, origin: string) {
  const normalizedOrigin = normalizeOrigin(origin);
  const sameRequestOrigin = requestOrigin(req);
  if (!normalizedOrigin) return false;

  return (
    isConfiguredWebOrigin(normalizedOrigin) ||
    (sameRequestOrigin ? normalizedOrigin === normalizeOrigin(sameRequestOrigin) : false)
  );
}
