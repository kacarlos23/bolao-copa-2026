import { createHash } from 'node:crypto';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown) {
  return JSON.stringify(sortValue(value));
}

export function checksum(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function redactProviderError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown provider error';
  return raw
    .replace(/https?:\/\/[^\s"']+/gi, '[remote-url]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /(authorization|cookie|token|secret|password)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]*/gi,
      '$1=[redacted]',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}
