import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import { newId, systemClock, type ActorType, type Clock } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { auditEvents } from '../schema.js';

export interface AuditAppendInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detailJson: string;
  createdAt: string;
}

export interface AuditListFilter {
  action?: string;
  actorType?: ActorType;
  targetId?: string;
  since?: string;
  limit?: number;
}

/** `audit_events` chỉ thêm và đọc (SPEC-00 §8, SPEC-05 §9). */
export class AuditRepo {
  constructor(
    private readonly db: DrizzleDb,
    private readonly clock: Clock = systemClock,
  ) {}

  append(input: AuditAppendInput): AuditRow {
    const row = {
      id: newId('audit', this.clock.nowMs()),
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      detailJson: JSON.stringify(input.detail ?? {}),
      createdAt: this.clock.nowIso(),
    };
    this.db.insert(auditEvents).values(row).run();
    return row;
  }

  list(filter: AuditListFilter = {}): AuditRow[] {
    const conds: SQL[] = [];
    if (filter.action) conds.push(eq(auditEvents.action, filter.action));
    if (filter.actorType) conds.push(eq(auditEvents.actorType, filter.actorType));
    if (filter.targetId) conds.push(eq(auditEvents.targetId, filter.targetId));
    if (filter.since) conds.push(gte(auditEvents.createdAt, filter.since));
    const q = this.db.select().from(auditEvents);
    const withWhere = conds.length > 0 ? q.where(and(...conds)) : q;
    return withWhere
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(filter.limit ?? 200)
      .all();
  }
}
