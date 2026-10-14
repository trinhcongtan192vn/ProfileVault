import { PvError } from '@sctech/profilevault-contract';
import type { FuryCapability } from './adapter/endpoint-map.js';

export type OfflineReason = 'url_invalid' | 'timeout' | 'network' | 'auth' | 'bad_response' | 'server';

export function furyOffline(reason: OfflineReason, message: string, extra: Record<string, unknown> = {}, cause?: unknown): PvError {
  return new PvError('FURY_OFFLINE', message, { reason, ...extra }, cause === undefined ? undefined : { cause });
}

/** Năng lực mà 404 nghĩa là "profile không tồn tại" (SPEC-01 §8) thay vì "route không có". */
const PROFILE_SCOPED: ReadonlySet<FuryCapability> = new Set(['getProfile', 'getStatus', 'launch', 'stop']);

/** Ánh xạ mã HTTP → PvError (SPEC-01 §8; research R1). */
export function mapHttpStatus(cap: FuryCapability, status: number, profileId?: string): PvError {
  if (status === 401 || status === 403) {
    return furyOffline('auth', 'Fury từ chối token (401/403). Nhập lại token ở Cài đặt → Kết nối Fury.', { status });
  }
  if (status === 404) {
    if (PROFILE_SCOPED.has(cap)) {
      return new PvError('INPUT_INVALID', `Profile Fury "${profileId ?? ''}" không tồn tại`, { profileId, status });
    }
    return new PvError('FURY_CAPABILITY_MISSING', `Fury không có endpoint cho năng lực ${cap}`, { capability: cap, status });
  }
  if (status === 409 && cap === 'launch') {
    return new PvError('PROFILE_BUSY', `Profile "${profileId ?? ''}" đang mở`, { profileId, status });
  }
  if (status >= 500) {
    return furyOffline('server', `Fury trả lỗi ${status}`, { status, capability: cap });
  }
  return furyOffline('bad_response', `Fury trả mã HTTP không mong đợi ${status}`, { status, capability: cap });
}

export function badResponse(cap: FuryCapability, issues: { path: string; message: string }[]): PvError {
  return furyOffline('bad_response', `Phản hồi Fury cho ${cap} thiếu trường bắt buộc`, { capability: cap, issues });
}

export function isRetryableFuryError(err: unknown): boolean {
  if (!(err instanceof PvError)) return false;
  if (err.code !== 'FURY_OFFLINE') return false;
  const reason = err.detail?.reason;
  return reason === 'network' || reason === 'timeout' || reason === 'server';
}
