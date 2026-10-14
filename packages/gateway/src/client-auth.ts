import { createHash } from 'node:crypto';
import { PvError, type Client, type Clock } from '@sctech/profilevault-contract';
import { stripHash, type ClientsRepo } from '@sctech/profilevault-db';
import { verifyClientToken } from './clients.js';

/** Xác thực Bearer cho `/api/v1` và `/mcp` (SPEC-05 §4.2) + giới hạn tần suất theo client (§8). */
export class ClientAuth {
  /** sha256(token) → clientId: argon2 chỉ chạy lần đầu; thu hồi vẫn kiểm mỗi request qua CSDL. */
  private readonly verified = new Map<string, string>();
  private readonly windows = new Map<string, number[]>();
  private readonly touched = new Map<string, number>();

  constructor(private readonly repo: ClientsRepo, private readonly clock: Clock) {}

  async authenticate(header: string | undefined): Promise<Client> {
    const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!token) throw new PvError('UNAUTHORIZED', 'Thiếu token (Authorization: Bearer <token>)', { reason: 'token_missing' });
    const key = createHash('sha256').update(token).digest('hex');
    let clientId = this.verified.get(key);
    if (!clientId) {
      const c = await verifyClientToken(this.repo, token);
      if (!c) throw new PvError('UNAUTHORIZED', 'Token không hợp lệ hoặc đã thu hồi', { reason: 'token_invalid' });
      clientId = c.id;
      this.verified.set(key, clientId);
    }
    const row = this.repo.get(clientId);
    if (!row || row.revokedAt) {
      this.verified.delete(key);
      throw new PvError('UNAUTHORIZED', 'Token không hợp lệ hoặc đã thu hồi', { reason: 'token_revoked' });
    }
    this.rateLimit(row.id, row.rateLimitPerMin);
    const now = this.clock.nowMs();
    // last_used_at tối đa mỗi phút một lần
    if (now - (this.touched.get(row.id) ?? 0) >= 60_000) {
      this.repo.touch(row.id, this.clock.nowIso());
      this.touched.set(row.id, now);
    }
    return stripHash(row);
  }

  private rateLimit(clientId: string, perMin: number): void {
    const now = this.clock.nowMs();
    const hits = (this.windows.get(clientId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= perMin) {
      const retryAfter = Math.max(1, Math.ceil((60_000 - (now - hits[0]!)) / 1000));
      this.windows.set(clientId, hits);
      throw new PvError('RATE_LIMITED', `Vượt ${perMin} request/phút`, { retryAfter });
    }
    hits.push(now);
    this.windows.set(clientId, hits);
  }
}
