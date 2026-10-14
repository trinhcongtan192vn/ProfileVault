/**
 * Nguồn kiểm exit (SPIKE-P5, 2026-10-15). API công khai của Fury 0.3.22 không có kiểm exit; app dùng IPC
 * `proxies.check` cần URL proxy có mật khẩu (ProfileVault không giữ). Thay vào đó:
 * - profile **không proxy**: exit chính là IP của máy → tra IP của máy (`selfUrl`);
 * - profile **có proxy**: Fury ghi `last_ip` của proxy (mỗi lần app kiểm proxy hoặc lần mở đầu tiên) → tra IP đó
 *   từ máy (`ipUrl`), KHÔNG đi qua proxy.
 * Dịch vụ tra mặc định giống Fury (ipinfo.io, định dạng `{ ip, city, country, timezone, org: "AS3320 …" }`).
 * Loại ASN không có ở nguồn miễn phí → `unknown`, người xác nhận qua `asn_attestations` (luật A5).
 */
import { z } from 'zod';
import { badResponse } from '../errors.js';

export interface ExitLookupConfig {
  /** Tra IP của chính máy (exit của profile không proxy). */
  selfUrl: string;
  /** Tra một IP cho trước; `{ip}` được thay. */
  ipUrl: string;
}

export const DEFAULT_EXIT_LOOKUP: ExitLookupConfig = {
  selfUrl: 'https://ipinfo.io/json',
  ipUrl: 'https://ipinfo.io/{ip}/json',
};

export interface ExitLookupResult {
  ip?: string;
  country?: string;
  city?: string;
  timezone?: string;
  asn?: number;
  asnOrg?: string;
}

const RawLookup = z
  .object({
    ip: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    timezone: z.string().optional(),
    org: z.string().optional(),
    // một số dịch vụ trả asn riêng
    asn: z.union([z.string(), z.number(), z.object({ asn: z.union([z.string(), z.number()]).optional(), name: z.string().optional() }).passthrough()]).optional(),
  })
  .passthrough();

function asnNumber(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^(?:AS)?(\d{1,10})$/i.exec(String(v).trim());
  return m ? Number(m[1]) : undefined;
}

/** Chuẩn hóa phản hồi kiểu ipinfo (`org: "AS3320 Deutsche Telekom AG"`). */
export function parseExitLookup(raw: unknown): ExitLookupResult {
  const r = RawLookup.safeParse(raw);
  if (!r.success) throw badResponse('checkExit', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const o = r.data;
  const out: ExitLookupResult = {};
  if (o.ip) out.ip = o.ip;
  if (o.country) out.country = o.country.toUpperCase();
  if (o.city) out.city = o.city;
  if (o.timezone) out.timezone = o.timezone;
  const orgMatch = o.org ? /^AS(\d+)\s*(.*)$/i.exec(o.org.trim()) : null;
  if (orgMatch) {
    out.asn = Number(orgMatch[1]);
    if (orgMatch[2]) out.asnOrg = orgMatch[2];
  }
  if (out.asn === undefined && o.asn !== undefined) {
    const v = typeof o.asn === 'object' ? o.asn.asn : o.asn;
    const n = asnNumber(v);
    if (n !== undefined) out.asn = n;
    if (typeof o.asn === 'object' && o.asn.name) out.asnOrg = o.asn.name;
  }
  return out;
}

export function lookupUrl(cfg: ExitLookupConfig, ip?: string): string {
  return ip ? cfg.ipUrl.replace('{ip}', encodeURIComponent(ip)) : cfg.selfUrl;
}
