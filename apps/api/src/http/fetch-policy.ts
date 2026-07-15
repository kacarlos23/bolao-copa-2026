export interface FetchTextPolicy {
  timeoutMs: number;
  maxBytes: number;
  retries: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

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

export async function fetchBytesWithPolicy(url: string, init: RequestInit, policy: FetchTextPolicy) {
  const fetchImpl = policy.fetchImpl ?? fetch;
  const sleep =
    policy.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = policy.random ?? Math.random;
  let lastError: unknown;

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
      return await responseBytesWithLimit(response, policy.maxBytes);
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
