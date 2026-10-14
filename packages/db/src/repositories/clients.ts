import { desc, eq } from 'drizzle-orm';
import type { Client, ClientScope } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { clients } from '../schema.js';

export interface ClientRow extends Client {
  tokenHash: string;
}

function toRow(r: typeof clients.$inferSelect): ClientRow {
  return {
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    tokenHash: r.tokenHash,
    scopes: JSON.parse(r.scopesJson) as ClientScope[],
    flowFilter: JSON.parse(r.flowFilterJson) as string[],
    bindingFilter: JSON.parse(r.bindingFilterJson) as string[],
    rateLimitPerMin: r.rateLimitPerMin,
    createdAt: r.createdAt,
    revokedAt: r.revokedAt,
    lastUsedAt: r.lastUsedAt,
  };
}

/** Không bao giờ trả `tokenHash` ra ngoài gateway. */
export function stripHash(c: ClientRow): Client {
  const { tokenHash: _h, ...rest } = c;
  return rest;
}

export class ClientsRepo {
  constructor(private readonly db: DrizzleDb) {}

  insert(c: ClientRow): void {
    this.db
      .insert(clients)
      .values({
        id: c.id,
        name: c.name,
        tokenPrefix: c.tokenPrefix,
        tokenHash: c.tokenHash,
        scopesJson: JSON.stringify(c.scopes),
        flowFilterJson: JSON.stringify(c.flowFilter),
        bindingFilterJson: JSON.stringify(c.bindingFilter),
        rateLimitPerMin: c.rateLimitPerMin,
        createdAt: c.createdAt,
        revokedAt: c.revokedAt,
        lastUsedAt: c.lastUsedAt,
      })
      .run();
  }

  get(id: string): ClientRow | undefined {
    const r = this.db.select().from(clients).where(eq(clients.id, id)).get();
    return r ? toRow(r) : undefined;
  }

  byPrefix(prefix: string): ClientRow | undefined {
    const r = this.db.select().from(clients).where(eq(clients.tokenPrefix, prefix)).get();
    return r ? toRow(r) : undefined;
  }

  list(): ClientRow[] {
    return this.db.select().from(clients).orderBy(desc(clients.createdAt)).all().map(toRow);
  }

  revoke(id: string, at: string): void {
    this.db.update(clients).set({ revokedAt: at }).where(eq(clients.id, id)).run();
  }

  touch(id: string, at: string): void {
    this.db.update(clients).set({ lastUsedAt: at }).where(eq(clients.id, id)).run();
  }
}
