/**
 * Fallback đọc cấu hình profile từ thư mục dữ liệu Fury khi automation API không trả (SPEC-01 §4).
 * CHỈ ĐỌC. SPIKE-P2: Fury 0.3.22 lưu profile trong `fury.db` (SQLite) và API đã trả đủ trường, nên service
 * KHÔNG dùng nguồn này; giữ lại cho trường hợp phiên bản sau bỏ trường khỏi API (tiêm `locate`/`parse`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FuryProfileDetail } from '@sctech/profilevault-contract';

export interface ProfileConfigFileSource {
  read(profileId: string): Promise<Partial<FuryProfileDetail> | undefined>;
}

export interface FsProfileConfigFileSourceOptions {
  dataDir: string;
  /** Đường dẫn file cấu hình của profile. Mặc định `<dataDir>/profiles/<id>/profile.json` (không phải định dạng thật của Fury). */
  locate?: (dataDir: string, profileId: string) => string;
  /** Chuyển JSON thô → trường của FuryProfileDetail. Mặc định chỉ lấy các trường trùng tên. */
  parse?: (raw: unknown) => Partial<FuryProfileDetail>;
}

const PICK: (keyof FuryProfileDetail)[] = ['personaId', 'osFamily', 'persona', 'seed', 'timezone', 'languages', 'geolocation', 'webrtcMode', 'proxyRef'];

export function defaultParseProfileConfig(raw: unknown): Partial<FuryProfileDetail> {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PICK) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export class FsProfileConfigFileSource implements ProfileConfigFileSource {
  private readonly locate: (dataDir: string, profileId: string) => string;
  private readonly parse: (raw: unknown) => Partial<FuryProfileDetail>;

  constructor(private readonly opts: FsProfileConfigFileSourceOptions) {
    this.locate = opts.locate ?? ((dir, id) => path.join(dir, 'profiles', id, 'profile.json'));
    this.parse = opts.parse ?? defaultParseProfileConfig;
  }

  async read(profileId: string): Promise<Partial<FuryProfileDetail> | undefined> {
    const file = this.locate(this.opts.dataDir, profileId);
    if (!existsSync(file)) return undefined;
    try {
      return this.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return undefined;
    }
  }
}
