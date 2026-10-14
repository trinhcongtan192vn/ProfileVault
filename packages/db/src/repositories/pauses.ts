import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Pause, PauseReason } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { bindingPauses } from '../schema.js';

function toPause(r: typeof bindingPauses.$inferSelect): Pause {
  return {
    id: r.id,
    bindingId: r.bindingId,
    reason: r.reason as PauseReason,
    detail: JSON.parse(r.detailJson) as Record<string, unknown>,
    createdAt: r.createdAt,
    clearedAt: r.clearedAt,
    clearedBy: r.clearedBy as 'user' | 'system' | null,
  };
}

export class PausesRepo {
  constructor(private readonly db: DrizzleDb) {}

  open(p: Pick<Pause, 'id' | 'bindingId' | 'reason' | 'detail' | 'createdAt'>): Pause {
    this.db
      .insert(bindingPauses)
      .values({ id: p.id, bindingId: p.bindingId, reason: p.reason, detailJson: JSON.stringify(p.detail), createdAt: p.createdAt })
      .run();
    return { ...p, clearedAt: null, clearedBy: null };
  }

  clear(id: string, clearedAt: string, clearedBy: 'user' | 'system'): void {
    this.db.update(bindingPauses).set({ clearedAt, clearedBy }).where(eq(bindingPauses.id, id)).run();
  }

  get(id: string): Pause | undefined {
    const r = this.db.select().from(bindingPauses).where(eq(bindingPauses.id, id)).get();
    return r ? toPause(r) : undefined;
  }

  findOpen(bindingId: string, reason: PauseReason): Pause | undefined {
    const r = this.db
      .select()
      .from(bindingPauses)
      .where(and(eq(bindingPauses.bindingId, bindingId), eq(bindingPauses.reason, reason), isNull(bindingPauses.clearedAt)))
      .get();
    return r ? toPause(r) : undefined;
  }

  listOpen(bindingId?: string): Pause[] {
    const base = this.db.select().from(bindingPauses);
    const q = bindingId ? base.where(and(eq(bindingPauses.bindingId, bindingId), isNull(bindingPauses.clearedAt))) : base.where(isNull(bindingPauses.clearedAt));
    return q.orderBy(desc(bindingPauses.createdAt)).all().map(toPause);
  }

  list(bindingId: string, opts: { open?: boolean } = {}): Pause[] {
    const base = this.db.select().from(bindingPauses);
    const q =
      opts.open === true
        ? base.where(and(eq(bindingPauses.bindingId, bindingId), isNull(bindingPauses.clearedAt)))
        : base.where(eq(bindingPauses.bindingId, bindingId));
    return q.orderBy(desc(bindingPauses.createdAt)).all().map(toPause);
  }
}
