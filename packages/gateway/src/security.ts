import { PvError, toApiError, type ApiError } from '@sctech/profilevault-contract';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Gateway chỉ được bind loopback (SPEC-05 §2). */
export function assertLoopback(host: string): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new PvError('INPUT_INVALID', `config.gateway.host phải là địa chỉ loopback (127.0.0.1/localhost), nhận "${host}"`, { host });
  }
}

/** Host header hợp lệ: `127.0.0.1:<port>` hoặc `localhost:<port>` (chống DNS rebinding). */
export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const h = hostHeader.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  const o = origin.toLowerCase().replace(/\/$/, '');
  return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}` || o === `http://[::1]:${port}`;
}

/** HTTP theo mã lỗi (SPEC-05 §10). */
export function httpStatusFor(code: string): number {
  switch (code) {
    case 'INPUT_INVALID':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN_SCOPE':
    case 'FORBIDDEN_ACTION':
      return 403;
    case 'ACCOUNT_NOT_BOUND':
    case 'FLOW_NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return 404;
    case 'BINDING_PAUSED':
    case 'LEVEL_TOO_LOW':
    case 'FLOW_DISABLED':
    case 'DAILY_LIMIT_REACHED':
    case 'FILE_NOT_ALLOWED':
    case 'FILE_CHANGED':
    case 'DUPLICATE_SUSPECTED':
    case 'PROFILE_BUSY':
      return 422;
    case 'RATE_LIMITED':
      return 429;
    case 'FURY_OFFLINE':
    case 'FURY_VERSION_UNSUPPORTED':
    case 'FURY_CAPABILITY_MISSING':
      return 503;
    default:
      return 500;
  }
}

export function mapError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof PvError) return { status: httpStatusFor(err.code), body: err.toApiError() };
  if (err instanceof z.ZodError) return { status: 400, body: toApiError(err) };
  const fe = err as FastifyError;
  if (fe && typeof fe === 'object' && 'code' in fe) {
    if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return { status: 413, body: { error: { code: 'INPUT_INVALID', message: 'Body vượt 1 MB', detail: { reason: 'body_too_large' } } } };
    if (fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || fe.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return { status: 400, body: { error: { code: 'INPUT_INVALID', message: 'Body không hợp lệ', detail: { reason: fe.code } } } };
    }
    if (fe.code === 'FST_ERR_NOT_FOUND' || fe.statusCode === 404) return { status: 404, body: { error: { code: 'FLOW_NOT_FOUND', message: 'Không có đường dẫn này' } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Lỗi nội bộ' } } };
}

/** Kiểm Zod, sai → PvError INPUT_INVALID (SPEC-00 §9). */
export function parse<S extends z.ZodType>(schema: S, value: unknown, where = 'body'): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new PvError('INPUT_INVALID', `Dữ liệu ${where} sai`, { where, issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) });
  }
  return r.data;
}

export function isWriteMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export type Req = FastifyRequest;
export type Rep = FastifyReply;
