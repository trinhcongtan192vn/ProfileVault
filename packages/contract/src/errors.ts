import { z } from 'zod';
import { JsonObjectSchema } from './common.js';

/** Chính sách thử lại: `no` không; `yes` có; `after` có sau điều kiện; `user` cần người; `maybe` tùy; `none` không áp dụng; `once` tối đa 1 lần. */
export type RetryPolicy = 'no' | 'yes' | 'after' | 'user' | 'maybe' | 'none' | 'once';

/** Mã lỗi dùng chung (SPEC-00 §9). */
export const ERROR_CODES = {
  INPUT_INVALID: { retry: 'no' },
  UNAUTHORIZED: { retry: 'no' },
  FORBIDDEN_SCOPE: { retry: 'no' },
  RATE_LIMITED: { retry: 'after' },
  FURY_OFFLINE: { retry: 'yes' },
  FURY_VERSION_UNSUPPORTED: { retry: 'no' },
  FURY_CAPABILITY_MISSING: { retry: 'no' },
  ACCOUNT_NOT_BOUND: { retry: 'no' },
  BINDING_PAUSED: { retry: 'after' },
  LEVEL_TOO_LOW: { retry: 'no' },
  FLOW_NOT_FOUND: { retry: 'no' },
  FLOW_DISABLED: { retry: 'no' },
  DAILY_LIMIT_REACHED: { retry: 'after' },
  DUPLICATE_JOB: { retry: 'no' },
  DUPLICATE_SUSPECTED: { retry: 'user' },
  FILE_NOT_ALLOWED: { retry: 'no' },
  FILE_NOT_FOUND: { retry: 'no' },
  FILE_CHANGED: { retry: 'no' },
  PROFILE_BUSY: { retry: 'yes' },
  SESSION_EXPIRED: { retry: 'user' },
  WRONG_ACCOUNT: { retry: 'user' },
  CHALLENGE: { retry: 'user' },
  SITE_CHANGED: { retry: 'no' },
  UPLOAD_REJECTED: { retry: 'no' },
  FORBIDDEN_ACTION: { retry: 'no' },
  INTERRUPTED: { retry: 'user' },
  TIMEOUT: { retry: 'maybe' },
  CANCELLED: { retry: 'none' },
  INTERNAL: { retry: 'once' },
} as const satisfies Record<string, { retry: RetryPolicy }>;

export type CommonErrorCode = keyof typeof ERROR_CODES;
const commonCodes = Object.keys(ERROR_CODES) as [CommonErrorCode, ...CommonErrorCode[]];
export const CommonErrorCodeSchema = z.enum(commonCodes);

/** Mã riêng của pack dạng `<PACK>_<NAME>` (SPEC-00 §9), ví dụ `YOUTUBE_PROCESSING_STUCK`. */
export const PackErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/, 'mã lỗi dạng <PACK>_<NAME>');

/** Mọi mã lỗi hợp lệ: mã chung hoặc mã pack. */
export const ErrorCodeSchema = z.union([CommonErrorCodeSchema, PackErrorCodeSchema]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export function isCommonErrorCode(code: string): code is CommonErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}

export function retryPolicy(code: string): RetryPolicy {
  return isCommonErrorCode(code) ? ERROR_CODES[code].retry : 'no';
}

/** Có nên tự thử lại (không cần người) không. */
export function isRetryable(code: string): boolean {
  const p = retryPolicy(code);
  return p === 'yes' || p === 'after' || p === 'once';
}

/** Định dạng lỗi trên API: `{ error: { code, message, detail } }`. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    detail: JsonObjectSchema.optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Lỗi có mã dùng xuyên suốt ProfileVault. */
export class PvError extends Error {
  readonly code: ErrorCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, detail?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'PvError';
    this.code = code;
    this.detail = detail;
  }

  toApiError(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) } };
  }
}

export function isPvError(err: unknown): err is PvError {
  return err instanceof PvError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'PvError');
}

/** Chuyển lỗi bất kỳ thành định dạng API; lỗi lạ → `INTERNAL`. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof PvError) return err.toApiError();
  if (err instanceof z.ZodError) {
    return {
      error: {
        code: 'INPUT_INVALID',
        message: 'Dữ liệu vào sai schema',
        detail: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: { code: 'INTERNAL', message } };
}
