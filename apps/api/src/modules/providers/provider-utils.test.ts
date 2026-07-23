import { describe, expect, it } from 'vitest';
import { checksum, redactProviderError } from './provider-utils.js';

describe('provider audit utilities', () => {
  it('produces a stable checksum independent of object key order', () => {
    expect(checksum({ b: 2, a: 1 })).toBe(checksum({ a: 1, b: 2 }));
  });

  it('redacts remote URLs and secrets from persisted errors', () => {
    const message = redactProviderError(
      new Error(
        'GET https://feed.example/path?token=raw Authorization: Bearer api.secret-value token=raw-secret password=hunter2',
      ),
    );
    expect(message).not.toContain('feed.example');
    expect(message).not.toContain('raw-secret');
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('api.secret-value');
    expect(message).toContain('[redacted]');
  });
});
