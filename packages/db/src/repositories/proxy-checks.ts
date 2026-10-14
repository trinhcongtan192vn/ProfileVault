import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { AsnType, ProxyCheck } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { bindings, proxyChecks } from '../schema.js';

function toCheck(r: typeof proxyChecks.$inferSelect): ProxyCheck {
  return {
    id: r.id,
    bindingId: r.bindingId,
    ok: r.ok,
    exitIp: r.exitIp,
    country: r.country,
    city: r.city,
    timezone: r.timezone,
    asn: r.asn,
    asnOrg: r.asnOrg,
    asnType: r.asnType as AsnType | null,
    latencyMs: r.latencyMs,
    error: r.error,
    checkedAt: r.checkedAt,
  };
}

export class ProxyChecksRepo {
  constructor(private readonly db: DrizzleDb) {}

  insert(c: ProxyCheck): void {
    this.db.insert(proxyChecks).values(c).run();
  }

  latest(bindingId: string): ProxyCheck | undefined {
    const r = this.db
      .select()
      .from(proxyChecks)
      .where(eq(proxyChecks.bindingId, bindingId))
      .orderBy(desc(proxyChecks.checkedAt), desc(proxyChecks.id))
      .get();
    return r ? toCheck(r) : undefined;
  }

  /** Lần kiểm `ok` gần nhất (loại trừ `excludeId` nếu có). */
  latestOk(bindingId: string, excludeId?: string): ProxyCheck | undefined {
    const conds = [eq(proxyChecks.bindingId, bindingId), eq(proxyChecks.ok, true)];
    if (excludeId) conds.push(ne(proxyChecks.id, excludeId));
    const r = this.db
      .select()
      .from(proxyChecks)
      .where(and(...conds))
      .orderBy(desc(proxyChecks.checkedAt), desc(proxyChecks.id))
      .get();
    return r ? toCheck(r) : undefined;
  }

  /** Lần kiểm `ok` gần nhất của mỗi binding chưa archive. */
  latestOkPerBinding(): ProxyCheck[] {
    const rows = this.db
      .select({ c: proxyChecks })
      .from(proxyChecks)
      .innerJoin(bindings, eq(bindings.id, proxyChecks.bindingId))
      .where(and(eq(proxyChecks.ok, true), isNull(bindings.archivedAt)))
      .orderBy(desc(proxyChecks.checkedAt), desc(proxyChecks.id))
      .all();
    const seen = new Map<string, ProxyCheck>();
    for (const { c } of rows) if (!seen.has(c.bindingId)) seen.set(c.bindingId, toCheck(c));
    return [...seen.values()];
  }

  list(bindingId: string, limit = 100): ProxyCheck[] {
    return this.db
      .select()
      .from(proxyChecks)
      .where(eq(proxyChecks.bindingId, bindingId))
      .orderBy(desc(proxyChecks.checkedAt), desc(proxyChecks.id))
      .limit(limit)
      .all()
      .map(toCheck);
  }
}
