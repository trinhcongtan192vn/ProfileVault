import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiErrorSchema, ERROR_CODES, ErrorCodeSchema, isRetryable, PvError, toApiError } from '../src/index.js';

describe('mã lỗi (SPEC-00 §9)', () => {
  it('có đủ 29 mã chung', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(29);
    expect(ERROR_CODES.LEVEL_TOO_LOW.retry).toBe('no');
    expect(ERROR_CODES.FURY_OFFLINE.retry).toBe('yes');
    expect(ERROR_CODES.RATE_LIMITED.retry).toBe('after');
  });

  it('chấp nhận mã pack dạng <PACK>_<NAME>, từ chối mã lạ', () => {
    expect(ErrorCodeSchema.safeParse('YOUTUBE_PROCESSING_STUCK').success).toBe(true);
    expect(ErrorCodeSchema.safeParse('lowercase_code').success).toBe(false);
    expect(ErrorCodeSchema.safeParse('NOUNDERSCORE').success).toBe(false);
  });

  it('PvError → định dạng API { error: { code, message, detail } }', () => {
    const err = new PvError('LEVEL_TOO_LOW', 'Mức binding thấp', { level: 1, required: 2 });
    const api = err.toApiError();
    expect(api).toEqual({ error: { code: 'LEVEL_TOO_LOW', message: 'Mức binding thấp', detail: { level: 1, required: 2 } } });
    expect(ApiErrorSchema.safeParse(api).success).toBe(true);
  });

  it('toApiError: lỗi lạ → INTERNAL; ZodError → INPUT_INVALID kèm issues', () => {
    expect(toApiError(new Error('boom')).error.code).toBe('INTERNAL');
    const r = z.object({ a: z.number() }).safeParse({ a: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const api = toApiError(r.error);
      expect(api.error.code).toBe('INPUT_INVALID');
      expect(api.error.detail).toBeDefined();
    }
  });

  it('isRetryable', () => {
    expect(isRetryable('FURY_OFFLINE')).toBe(true);
    expect(isRetryable('INTERNAL')).toBe(true);
    expect(isRetryable('SESSION_EXPIRED')).toBe(false);
    expect(isRetryable('YOUTUBE_X')).toBe(false);
  });
});
