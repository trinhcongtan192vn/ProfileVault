import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ClientCreateInputSchema, newId, PvError, type Client, type ClientCreateInput, type Clock } from '@sctech/profilevault-contract';
import { stripHash, type AuditRepo, type ClientsRepo } from '@sctech/profilevault-db';

/** Token client `pv_<prefix 8>_<32 byte base64url>`; lưu prefix + argon2id(bí mật) (SPEC-05 §4.2). */
export async function createClient(repo: ClientsRepo, audit: AuditRepo, clock: Clock, input: ClientCreateInput, random: (n: number) => Buffer = randomBytes): Promise<{ client: Client; token: string }> {
  const parsed = ClientCreateInputSchema.safeParse(input);
  if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu client sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) });
  const v = parsed.data;
  let prefix = random(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  while (repo.byPrefix(prefix)) prefix = random(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  const secret = random(32).toString('base64url');
  const tokenHash = await argon2.hash(secret, { type: argon2.argon2id });
  const row = {
    id: newId('client', clock.nowMs()),
    name: v.name,
    tokenPrefix: prefix,
    tokenHash,
    scopes: v.scopes,
    flowFilter: v.flowFilter,
    bindingFilter: v.bindingFilter,
    rateLimitPerMin: v.rateLimitPerMin,
    createdAt: clock.nowIso(),
    revokedAt: null,
    lastUsedAt: null,
  };
  repo.insert(row);
  audit.append({ actorType: 'user', action: 'client.create', targetType: 'client', targetId: row.id, detail: { name: v.name, scopes: v.scopes, tokenPrefix: prefix } });
  return { client: stripHash(row), token: `pv_${prefix}_${secret}` };
}

export function revokeClient(repo: ClientsRepo, audit: AuditRepo, clock: Clock, id: string): Client {
  const c = repo.get(id);
  if (!c) throw new PvError('INPUT_INVALID', 'Không có client này', { clientId: id });
  if (!c.revokedAt) {
    repo.revoke(id, clock.nowIso());
    audit.append({ actorType: 'user', action: 'client.revoke', targetType: 'client', targetId: id });
  }
  return stripHash(repo.get(id)!);
}

/** Xác thực Bearer (dùng ở M1 cho /api/v1 và /mcp). */
export async function verifyClientToken(repo: ClientsRepo, token: string): Promise<Client | undefined> {
  const m = /^pv_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{40,46})$/.exec(token);
  if (!m) return undefined;
  const row = repo.byPrefix(m[1]!);
  if (!row || row.revokedAt) return undefined;
  const ok = await argon2.verify(row.tokenHash, m[2]!);
  return ok ? stripHash(row) : undefined;
}
