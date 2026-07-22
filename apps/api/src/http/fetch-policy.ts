import * as tls from 'node:tls';

// Node 22+ can merge the operating-system trust store with its bundled roots.
// This keeps official HTTPS collection working behind managed Windows PKI
// without disabling certificate verification. Older supported runtimes simply
// retain Node's bundled trust store.
if (
  process.platform === 'win32' &&
  typeof tls.getCACertificates === 'function' &&
  typeof tls.setDefaultCACertificates === 'function'
) {
  const certificates = [...tls.getCACertificates('default'), ...tls.getCACertificates('system')];
  tls.setDefaultCACertificates([...new Set(certificates)]);
}

export interface FetchTextPolicy {
  timeoutMs: number;
  maxBytes: number;
  retries: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  cache?: ProviderResponseCache;
  cacheTtlMs?: number;
}

export class ProviderResponseCache {
  private readonly entries = new Map<string, { expiresAt: number; bytes: Buffer }>();

  constructor(private readonly maxEntries = 100) {}

  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return Buffer.from(entry.bytes);
  }

  set(key: string, bytes: Buffer, ttlMs: number, now = Date.now()) {
    if (ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: now + ttlMs, bytes: Buffer.from(bytes) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export const sharedProviderResponseCache = new ProviderResponseCache();

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeded the ${maxBytes} byte limit.`);
    this.name = 'ResponseTooLargeError';
  }
}

class RetryableHttpError extends Error {
  constructor(readonly status: number) {
    super(`Remote server returned retryable status ${status}.`);
  }
}

function isRetryable(error: unknown) {
  return (
    error instanceof RetryableHttpError ||
    (error instanceof Error && (error.name === 'AbortError' || error instanceof TypeError))
  );
}

async function responseBytesWithLimit(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new ResponseTooLargeError(maxBytes);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function fetchBytesWithPolicy(
  url: string,
  init: RequestInit,
  policy: FetchTextPolicy,
) {
  const fetchImpl = policy.fetchImpl ?? fetch;
  const sleep =
    policy.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = policy.random ?? Math.random;
  let lastError: unknown;
  const cacheKey = `${init.method ?? 'GET'}:${url}:${JSON.stringify(init.headers ?? {})}`;
  const cached = policy.cache?.get(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
      });
      if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        throw new RetryableHttpError(response.status);
      }
      if (!response.ok) throw new Error(`Remote server returned ${response.status} for ${url}.`);
      const bytes = await responseBytesWithLimit(response, policy.maxBytes);
      policy.cache?.set(cacheKey, bytes, policy.cacheTtlMs ?? 0);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt >= policy.retries || !isRetryable(error)) throw error;
      const delay = Math.round(200 * 2 ** attempt + random() * 200);
      await sleep(delay);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

export async function fetchTextWithPolicy(url: string, init: RequestInit, policy: FetchTextPolicy) {
  return (await fetchBytesWithPolicy(url, init, policy)).toString('utf8');
}
