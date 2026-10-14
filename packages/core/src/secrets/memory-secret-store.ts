import type { SecretKey } from '@sctech/profilevault-contract';
import type { SecretStore } from './secret-store.js';

/** CHỈ DÙNG CHO TEST: không mã hóa, không lưu đĩa. Sản phẩm dùng `DpapiSecretStore`. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<SecretKey, string>();

  constructor(initial: Partial<Record<SecretKey, string>> = {}) {
    for (const [k, v] of Object.entries(initial)) if (v !== undefined) this.map.set(k as SecretKey, v);
  }

  async get(key: SecretKey): Promise<string | undefined> {
    return this.map.get(key);
  }

  async set(key: SecretKey, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: SecretKey): Promise<void> {
    this.map.delete(key);
  }

  async keys(): Promise<SecretKey[]> {
    return [...this.map.keys()];
  }

  async values(): Promise<string[]> {
    return [...this.map.values()];
  }
}
