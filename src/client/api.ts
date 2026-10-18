import { loadClientConfig } from './clientConfig';
/** Thin fetch wrapper. Every failure becomes an ApiError with a code the UI can explain. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.code === 'network';
  }
}

/** Bodies below this are never worth compressing (and never need the server's config). */
const COMPRESS_MIN_CHARS = 256 * 1024;

/**
 * JSON body for a request. Large uploads (e.g. a whole Spotify data export) are
 * gzip-compressed when the server asks for it: serverless hosts limit request size.
 */
async function encodeBody(body: unknown): Promise<{ data: BodyInit; headers: Record<string, string> }> {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (json.length < COMPRESS_MIN_CHARS || typeof CompressionStream !== 'function') return { data: json, headers };
  const cfg = await loadClientConfig();
  if (cfg.compressAboveBytes === null || json.length <= cfg.compressAboveBytes) return { data: json, headers };
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  if (cfg.maxRequestBytes !== null && gz.size > cfg.maxRequestBytes) {
    throw new ApiError(413, 'too_large', 'This file is too large to upload. Split it into smaller files and try again.');
  }
  return { data: gz, headers: { ...headers, 'Content-Encoding': 'gzip' } };
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  const encoded = body !== undefined ? await encodeBody(body) : null;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: encoded?.headers,
      body: encoded?.data,
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Could not reach SOMM. Check your connection and try again.');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${res.status}).`, (e as Record<string, unknown>) ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
