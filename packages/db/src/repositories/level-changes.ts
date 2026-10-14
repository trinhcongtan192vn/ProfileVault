import { desc, eq } from 'drizzle-orm';
import type { AutomationLevel, LevelChange } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { levelChanges } from '../schema.js';

function toChange(r: typeof levelChanges.$inferSelect): LevelChange {
  return {
    id: r.id,
    bindingId: r.bindingId,
    fromLevel: r.fromLevel as AutomationLevel,
    toLevel: r.toLevel as AutomationLevel,
    kind: r.kind as 'promote' | 'demote',
    reason: r.reason,
    detail: JSON.parse(r.detailJson) as Record<string, unknown>,
    actor: r.actor,
    createdAt: r.createdAt,
  };
}

/** `level_changes` chỉ thêm và đọc. */
export class LevelChangesRepo {
  constructor(private readonly db: DrizzleDb) {}

  append(c: LevelChange): void {
    this.db
      .insert(levelChanges)
      .values({
        id: c.id,
        bindingId: c.bindingId,
        fromLevel: c.fromLevel,
        toLevel: c.toLevel,
        kind: c.kind,
        reason: c.reason,
        detailJson: JSON.stringify(c.detail),
        actor: c.actor,
        createdAt: c.createdAt,
      })
      .run();
  }

  list(bindingId: string, limit = 200): LevelChange[] {
    return this.db
      .select()
      .from(levelChanges)
      .where(eq(levelChanges.bindingId, bindingId))
      .orderBy(desc(levelChanges.createdAt), desc(levelChanges.id))
      .limit(limit)
      .all()
      .map(toChange);
  }
}
