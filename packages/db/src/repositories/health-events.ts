import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import type { EventSeverity, EventSource, HealthEventRecord, HealthEventType } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { healthEvents } from '../schema.js';

export interface HealthEventFilter {
  /** `null` = sự kiện toàn hệ thống; `undefined` = mọi binding. */
  bindingId?: string | null;
  types?: string[];
  since?: string;
  until?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

function toRecord(r: typeof healthEvents.$inferSelect): HealthEventRecord {
  return {
    id: r.id,
    bindingId: r.bindingId,
    type: r.type as HealthEventType,
    severity: r.severity as EventSeverity,
    source: r.source as EventSource,
    payload: JSON.parse(r.payloadJson) as Record<string, unknown>,
    occurredAt: r.occurredAt,
    recordedAt: r.recordedAt,
  };
}

/** `health_events` chỉ thêm và đọc (SPEC-00 §8). */
export class HealthEventsRepo {
  constructor(private readonly db: DrizzleDb) {}

  append(e: HealthEventRecord): void {
    this.db
      .insert(healthEvents)
      .values({
        id: e.id,
        bindingId: e.bindingId,
        type: e.type,
        severity: e.severity,
        source: e.source,
        payloadJson: JSON.stringify(e.payload),
        occurredAt: e.occurredAt,
        recordedAt: e.recordedAt,
      })
      .run();
  }

  private where(f: HealthEventFilter): SQL | undefined {
    const conds: SQL[] = [];
    if (f.bindingId === null) conds.push(isNull(healthEvents.bindingId));
    else if (f.bindingId !== undefined) conds.push(eq(healthEvents.bindingId, f.bindingId));
    if (f.types && f.types.length > 0) conds.push(inArray(healthEvents.type, f.types));
    if (f.since) conds.push(gte(healthEvents.occurredAt, f.since));
    if (f.until) conds.push(lte(healthEvents.occurredAt, f.until));
    return conds.length > 0 ? and(...conds) : undefined;
  }

  list(f: HealthEventFilter = {}): HealthEventRecord[] {
    const w = this.where(f);
    const base = this.db.select().from(healthEvents);
    const q = w ? base.where(w) : base;
    const ordered = f.order === 'asc' ? q.orderBy(asc(healthEvents.occurredAt), asc(healthEvents.id)) : q.orderBy(desc(healthEvents.occurredAt), desc(healthEvents.id));
    return ordered
      .limit(f.limit ?? 500)
      .all()
      .map(toRecord);
  }

  count(f: HealthEventFilter = {}): number {
    const w = this.where(f);
    const base = this.db.select({ id: healthEvents.id }).from(healthEvents);
    return (w ? base.where(w) : base).all().length;
  }
}
