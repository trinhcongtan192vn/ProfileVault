import { randomBytes } from 'node:crypto';
import type { SecretKey } from '@sctech/profilevault-contract';

/**
 * Kho bí mật của chính ProfileVault (SPEC-00 §5): token Fury, khóa HMAC, khóa LLM.
 * Không bao giờ chứa cookie/mật khẩu/proxy của profile. Giá trị không được log.
 */
export interface SecretStore {
  get(key: SecretKey): Promise<string | undefined>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
  keys(): Promise<SecretKey[]>;
  /** Mọi giá trị hiện có — chỉ dùng để che trong log. */
  values(): Promise<string[]>;
}

/** Sinh khóa HMAC 32 byte (base64) nếu chưa có (SPEC-00 §11 lần chạy đầu). */
export async function ensureHmacKey(store: SecretStore): Promise<{ created: boolean }> {
  const existing = await store.get('hmac.key');
  if (existing) return { created: false };
  await store.set('hmac.key', randomBytes(32).toString('base64'));
  return { created: true };
}
