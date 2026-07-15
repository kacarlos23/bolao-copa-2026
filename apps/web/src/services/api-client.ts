import { apiErrorSchema, type ApiIssue } from '@bolao/shared';
import type { z } from 'zod';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  schema?: z.ZodTypeAny;
  idempotencyKey?: string;
}

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

async function fetchCsrfToken(signal?: AbortSignal) {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_URL}/api/auth/csrf`, { credentials: 'include', signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new ApiError('Não foi possível iniciar uma requisição segura.', response.status, 'CSRF_UNAVAILABLE');
        }
        const body = (await response.json()) as { csrfToken?: unknown };
        if (typeof body.csrfToken !== 'string' || body.csrfToken.length < 32) {
          throw new ApiError('O servidor não forneceu um token de segurança válido.', 500, 'CSRF_INVALID');
        }
        csrfToken = body.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

function abortError() {
  return new DOMException('A requisição foi cancelada.', 'AbortError');
}

function mergedController(externalSignal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason ?? abortError());
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException('A requisição excedeu o tempo limite.', 'TimeoutError')),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
    },
  };
}

async function parseApiError(response: Response) {
  const raw = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(raw);
  if (parsed.success) {
    const { status, code, message, requestId, issues } = parsed.data.error;
    return new ApiError(message, status, code, requestId, issues);
  }
  const legacy = raw as
    | { error?: { message?: string; issues?: { fieldErrors?: Record<string, string[]> } } }
    | null;
  const firstFieldError = legacy?.error?.issues?.fieldErrors
    ? Object.values(legacy.error.issues.fieldErrors).flat().find(Boolean)
    : undefined;
  return new ApiError(
    legacy?.error?.message ?? firstFieldError ?? 'Não foi possível concluir a operação.',
    response.status,
    `HTTP_${response.status}`,
  );
}

export function request<T>(
  path: string,
  options: Omit<RequestOptions, 'schema'> & { schema: z.ZodType<T> },
): Promise<T>;
export function request<T>(path: string, options?: RequestOptions): Promise<T>;
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { schema, timeoutMs = 15_000, idempotencyKey, ...fetchOptions } = options;
  const method = (fetchOptions.method ?? 'GET').toUpperCase();
  const isSafe = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const operation = mergedController(fetchOptions.signal, timeoutMs);
  try {
    const token = isSafe ? undefined : await fetchCsrfToken(operation.signal);
    const response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      credentials: 'include',
      signal: operation.signal,
      headers: {
        ...(!isFormData ? { 'content-type': 'application/json' } : {}),
        ...(fetchOptions.headers ?? {}),
        ...(token ? { 'x-csrf-token': token } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) csrfToken = null;
      throw await parseApiError(response);
    }
    if (response.status === 204) return undefined as T;
    const raw: unknown = await response.json();
    if (!schema) return raw as T;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(
        'O servidor respondeu em um formato incompatível. Atualize a página e tente novamente.',
        502,
        'INVALID_RESPONSE',
        undefined,
        parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      );
    }
    return parsed.data as T;
  } finally {
    operation.dispose();
  }
}

export class LatestRequest {
  private sequence = 0;
  private controller: AbortController | null = null;

  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    this.controller?.abort();
    this.controller = new AbortController();
    const current = ++this.sequence;
    try {
      const result = await operation(this.controller.signal);
      return current === this.sequence ? result : undefined;
    } catch (error) {
      if (current !== this.sequence || (error instanceof Error && error.name === 'AbortError')) {
        return undefined;
      }
      throw error;
    }
  }

  cancel() {
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.';
    if (error.status === 403) return 'Você não tem permissão para esta ação.';
    if (error.status === 409) return error.message;
    if (error.status >= 500) return `${error.message} Tente novamente em instantes.`;
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}
