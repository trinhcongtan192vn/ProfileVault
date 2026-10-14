import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '@sctech/profilevault-contract';

export const SESSION_COOKIE = 'pv_session';
export const CSRF_HEADER = 'x-pv-csrf';
export const OPEN_CODE_TTL_MS = 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;

type Random = (bytes: number) => Buffer;

/** Mã mở dashboard một lần, 32 byte, hiệu lực 60 giây (SPEC-05 §4.1). */
export class OpenCodeStore {
  private readonly codes = new Map<string, number>();
  constructor(
    private readonly clock: Clock,
    private readonly random: Random = randomBytes,
    private readonly ttlMs = OPEN_CODE_TTL_MS,
  ) {}

  create(): string {
    this.sweep();
    const code = this.random(32).toString('base64url');
    this.codes.set(code, this.clock.nowMs() + this.ttlMs);
    return code;
  }

  /** Dùng một lần: trả true và xóa nếu hợp lệ. */
  consume(code: string | undefined): boolean {
    this.sweep();
    if (!code) return false;
    const exp = this.codes.get(code);
    if (exp === undefined) return false;
    this.codes.delete(code);
    return exp > this.clock.nowMs();
  }

  private sweep(): void {
    const now = this.clock.nowMs();
    for (const [c, exp] of this.codes) if (exp <= now) this.codes.delete(c);
  }
}

export interface Session {
  id: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

/** Phiên dashboard: 12 giờ, gia hạn khi dùng (SPEC-05 §4.1). */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly clock: Clock,
    private readonly random: Random = randomBytes,
    private readonly ttlMs = SESSION_TTL_MS,
  ) {}

  create(): Session {
    const now = this.clock.nowMs();
    const s: Session = { id: this.random(32).toString('base64url'), csrfToken: this.random(32).toString('base64url'), createdAt: now, expiresAt: now + this.ttlMs };
    this.sessions.set(s.id, s);
    return s;
  }

  /** Lấy và gia hạn; hết hạn → xóa, trả undefined. */
  touch(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    const s = this.sessions.get(id);
    if (!s) return undefined;
    const now = this.clock.nowMs();
    if (s.expiresAt <= now) {
      this.sessions.delete(id);
      return undefined;
    }
    s.expiresAt = now + this.ttlMs;
    return s;
  }

  destroy(id: string): void {
    this.sessions.delete(id);
  }

  csrfValid(s: Session, header: string | undefined): boolean {
    if (!header) return false;
    const a = Buffer.from(s.csrfToken);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  count(): number {
    return this.sessions.size;
  }
}
