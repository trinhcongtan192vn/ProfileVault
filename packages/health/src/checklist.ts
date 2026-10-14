import { createHmac } from 'node:crypto';
import { CHECKLIST_VALIDITY_DAYS, ChecklistInputSchema, PvError, type ChecklistInput, type ChecklistStatus, type Clock } from '@sctech/profilevault-contract';
import type { SecretStore } from '@sctech/profilevault-core';
import type { AuditRepo, ChecklistRow, ChecklistsRepo } from '@sctech/profilevault-db';
import { CHECKLIST_FIELDS, checklistMissing } from './rules/layer-c.js';

/** Email: chữ thường, bỏ khoảng trắng (SPEC-02 §6.8). */
export function normalizeEmail(v: string): string {
  const s = v.replace(/\s+/g, '').toLowerCase();
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(s)) throw new PvError('INPUT_INVALID', 'Email khôi phục không hợp lệ', { field: 'recoveryEmail' });
  return s;
}

/** Số điện thoại: E.164 (`+` và chữ số). */
export function normalizePhone(v: string): string {
  const digits = v.replace(/[^\d+]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(digits)) throw new PvError('INPUT_INVALID', 'Số khôi phục phải ở dạng E.164 (ví dụ +491512345678)', { field: 'recoveryPhone' });
  return digits;
}

export function hmacHex(keyBase64: string, value: string): string {
  return createHmac('sha256', Buffer.from(keyBase64, 'base64')).update(value, 'utf8').digest('hex');
}

export interface ChecklistDeps {
  repo: ChecklistsRepo;
  secrets: SecretStore;
  clock: Clock;
  audit: AuditRepo;
}

export function toStatus(bindingId: string, row: ChecklistRow | undefined, now: Date): ChecklistStatus {
  const missing = checklistMissing(row);
  const expiresAt = row?.expiresAt ?? null;
  return {
    bindingId,
    accountRegion: row?.accountRegion ?? null,
    channelCountry: row?.channelCountry ?? null,
    accountLanguage: row?.accountLanguage ?? null,
    hasRecoveryEmail: !!row?.recoveryEmailHmac,
    hasRecoveryPhone: !!row?.recoveryPhoneHmac,
    twofaEnabled: row?.twofaEnabled ?? null,
    exclusiveLoginConfirmed: row?.exclusiveLoginConfirmed ?? null,
    studioLanguageSet: row?.studioLanguageSet ?? null,
    confirmedAt: row?.confirmedAt ?? null,
    expiresAt,
    updatedAt: row?.updatedAt ?? null,
    complete: missing.length === 0,
    expired: !expiresAt || Date.parse(expiresAt) <= now.getTime(),
    missing,
  };
}

/** Checklist tài khoản (SPEC-02 §6.8): chỉ lưu HMAC, không bao giờ trả giá trị gốc. */
export class ChecklistService {
  constructor(private readonly d: ChecklistDeps) {}

  private async key(): Promise<string> {
    const k = await this.d.secrets.get('hmac.key');
    if (!k) throw new PvError('INTERNAL', 'Thiếu khóa HMAC trong kho bí mật', { reason: 'hmac_key_missing' });
    return k;
  }

  async upsert(bindingId: string, input: ChecklistInput, actor: 'user' | 'client' = 'user'): Promise<ChecklistStatus> {
    const parsed = ChecklistInputSchema.safeParse(input);
    if (!parsed.success) throw new PvError('INPUT_INVALID', 'Checklist sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const v = parsed.data;
    const key = v.recoveryEmail !== undefined || v.recoveryPhone !== undefined ? await this.key() : undefined;
    const now = this.d.clock.nowIso();
    const patch: Parameters<ChecklistsRepo['upsert']>[0] = { bindingId, updatedAt: now };
    if (v.accountRegion !== undefined) patch.accountRegion = v.accountRegion;
    if (v.channelCountry !== undefined) patch.channelCountry = v.channelCountry;
    if (v.accountLanguage !== undefined) patch.accountLanguage = v.accountLanguage;
    if (v.recoveryEmail !== undefined && key) patch.recoveryEmailHmac = v.recoveryEmail.trim() === '' ? null : hmacHex(key, normalizeEmail(v.recoveryEmail));
    if (v.recoveryPhone !== undefined && key) patch.recoveryPhoneHmac = v.recoveryPhone.trim() === '' ? null : hmacHex(key, normalizePhone(v.recoveryPhone));
    if (v.twofaEnabled !== undefined) patch.twofaEnabled = v.twofaEnabled;
    if (v.exclusiveLoginConfirmed !== undefined) patch.exclusiveLoginConfirmed = v.exclusiveLoginConfirmed;
    if (v.studioLanguageSet !== undefined) patch.studioLanguageSet = v.studioLanguageSet;
    const row = this.d.repo.upsert(patch);
    this.d.audit.append({ actorType: actor, action: 'checklist.upsert', targetType: 'binding', targetId: bindingId, detail: { fields: Object.keys(patch).filter((k) => k !== 'bindingId' && k !== 'updatedAt') } });
    return toStatus(bindingId, row, this.d.clock.now());
  }

  /** Xác nhận: đủ trường → `confirmed_at = now`, `expires_at = +90 ngày`. */
  confirm(bindingId: string, actor: 'user' = 'user'): ChecklistStatus {
    const row = this.d.repo.get(bindingId);
    const missing = checklistMissing(row);
    if (missing.length > 0) throw new PvError('INPUT_INVALID', `Checklist còn thiếu: ${missing.join(', ')}`, { missing });
    const now = this.d.clock.now();
    const expires = new Date(now.getTime() + CHECKLIST_VALIDITY_DAYS * 86_400_000).toISOString();
    const updated = this.d.repo.upsert({ bindingId, updatedAt: now.toISOString(), confirmedAt: now.toISOString(), expiresAt: expires });
    this.d.audit.append({ actorType: actor, action: 'checklist.confirm', targetType: 'binding', targetId: bindingId, detail: { expiresAt: expires } });
    return toStatus(bindingId, updated, now);
  }

  status(bindingId: string): ChecklistStatus {
    return toStatus(bindingId, this.d.repo.get(bindingId), this.d.clock.now());
  }

  isValid(bindingId: string): boolean {
    const s = this.status(bindingId);
    return s.complete && !s.expired;
  }

  /** Checklist hết hạn trong `days` ngày tới (kể cả đã hết hạn nhưng còn trong cửa sổ). */
  expiring(days: number): ChecklistStatus[] {
    const now = this.d.clock.now();
    const to = new Date(now.getTime() + days * 86_400_000).toISOString();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    return this.d.repo.expiringBetween(from, to).map((r) => toStatus(r.bindingId, r, now));
  }

  expiredToday(): ChecklistStatus[] {
    const now = this.d.clock.now();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    return this.d.repo.expiringBetween(from, now.toISOString()).map((r) => toStatus(r.bindingId, r, now));
  }
}

export { CHECKLIST_FIELDS };
