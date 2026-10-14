import { PvError, SecretKeySchema, type SecretKey } from '@sctech/profilevault-contract';
import { readSecretsFile, writeSecretsFile } from './secrets-file.js';
import type { SecretStore } from './secret-store.js';

const ENTROPY = Buffer.from('ProfileVault', 'utf8');

interface DpapiModule {
  Dpapi: {
    protectData(data: Uint8Array, entropy: Uint8Array | null, scope: 'CurrentUser' | 'LocalMachine'): Uint8Array;
    unprotectData(data: Uint8Array, entropy: Uint8Array | null, scope: 'CurrentUser' | 'LocalMachine'): Uint8Array;
  };
}

let dpapiPromise: Promise<DpapiModule> | undefined;
async function loadDpapi(): Promise<DpapiModule> {
  if (process.platform !== 'win32') {
    throw new PvError('INTERNAL', 'DPAPI chỉ có trên Windows; truyền SecretStore khác khi chạy test ngoài Windows', {
      reason: 'platform_unsupported',
      platform: process.platform,
    });
  }
  dpapiPromise ??= import('@primno/dpapi') as unknown as Promise<DpapiModule>;
  return dpapiPromise;
}

/**
 * Kho bí mật mã hóa bằng Windows DPAPI phạm vi người dùng hiện tại, lưu `secrets.bin` (SPEC-00 §3, §5).
 * Mỗi entry mã hóa riêng; file chỉ chứa blob base64, không bao giờ chứa giá trị gốc.
 */
export class DpapiSecretStore implements SecretStore {
  constructor(private readonly file: string) {}

  private async decrypt(blobB64: string, key: string): Promise<string> {
    const { Dpapi } = await loadDpapi();
    try {
      const plain = Dpapi.unprotectData(Buffer.from(blobB64, 'base64'), ENTROPY, 'CurrentUser');
      return Buffer.from(plain).toString('utf8');
    } catch (err) {
      throw new PvError(
        'INTERNAL',
        `Không giải mã được bí mật "${key}" (secrets.bin có thể được tạo bởi tài khoản Windows khác). Xóa secrets.bin và nhập lại token.`,
        { reason: 'secrets_undecryptable', key, file: this.file },
        { cause: err },
      );
    }
  }

  async get(key: SecretKey): Promise<string | undefined> {
    const data = readSecretsFile(this.file);
    const blob = data.entries[key];
    if (blob === undefined) return undefined;
    return this.decrypt(blob, key);
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const { Dpapi } = await loadDpapi();
    const data = readSecretsFile(this.file);
    const blob = Dpapi.protectData(Buffer.from(value, 'utf8'), ENTROPY, 'CurrentUser');
    data.entries[key] = Buffer.from(blob).toString('base64');
    writeSecretsFile(this.file, data);
  }

  async delete(key: SecretKey): Promise<void> {
    const data = readSecretsFile(this.file);
    if (!(key in data.entries)) return;
    delete data.entries[key];
    writeSecretsFile(this.file, data);
  }

  async keys(): Promise<SecretKey[]> {
    const data = readSecretsFile(this.file);
    return Object.keys(data.entries).filter((k): k is SecretKey => SecretKeySchema.safeParse(k).success);
  }

  async values(): Promise<string[]> {
    const out: string[] = [];
    for (const k of await this.keys()) {
      const v = await this.get(k);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
}
