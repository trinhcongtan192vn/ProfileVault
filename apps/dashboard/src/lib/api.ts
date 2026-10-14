/** Lớp gọi API nội bộ `/internal/*` (SPEC-05 §4.1, §7): cookie phiên + `X-PV-CSRF` cho phương thức ghi. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Listener = (expired: boolean) => void;
const sessionListeners = new Set<Listener>();
let csrfToken: string | null = null;

export function onSessionExpired(l: Listener): () => void {
  sessionListeners.add(l);
  return () => sessionListeners.delete(l);
}

function notifyExpired(): void {
  csrfToken = null;
  for (const l of sessionListeners) l(true);
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'INTERNAL';
  let message = `HTTP ${res.status}`;
  let detail: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; detail?: Record<string, unknown> } };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      detail = body.error.detail;
    }
  } catch {
    /* không phải JSON */
  }
  return new ApiError(res.status, code, message, detail);
}

async function ensureCsrf(fetchFn: typeof fetch): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetchFn('/internal/session', { credentials: 'same-origin' });
  if (res.status === 401) {
    notifyExpired();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
  return csrfToken;
}

export interface ApiOptions {
  body?: unknown;
  /** FormData cho multipart. */
  form?: FormData;
  fetchFn?: typeof fetch;
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: ApiOptions = {}): Promise<T> {
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['x-pv-csrf'] = await ensureCsrf(fetchFn);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetchFn(path, { method, headers, body, credentials: 'same-origin' });
  if (res.status === 401) {
    notifyExpired();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, { body: body ?? {} });
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, { body });
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, { body });
export const del = <T>(path: string) => api<T>('DELETE', path);

/** Thông điệp lỗi tiếng Việt để hiển thị. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const missing = err.detail?.missing;
    if (Array.isArray(missing) && missing.length > 0) return `${err.message} (thiếu: ${missing.join(', ')})`;
    return `${err.message} [${err.code}]`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Chỉ cho test. */
export function __resetCsrf(): void {
  csrfToken = null;
}
