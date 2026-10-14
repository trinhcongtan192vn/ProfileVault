import { lt } from 'drizzle-orm';
import type { DrizzleDb } from './open.js';
import { auditEvents, healthEvents, levelChanges, settingsHistory } from './schema.js';

export interface PruneOptions {
  /** `retention.dataMonths` (SPEC-00 §5). */
  retentionMonths: number;
  now: Date;
}

export interface PruneResult {
  cutoff: string;
  deleted: Record<'health_events' | 'level_changes' | 'audit_events' | 'settings_history', number>;
}

/** Dọn 4 bảng chỉ thêm theo retention — cách duy nhất được xóa trên các bảng này (SPEC-00 §8). */
export function pruneAppendOnly(db: DrizzleDb, opts: PruneOptions): PruneResult {
  const cutoffDate = new Date(opts.now);
  cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - opts.retentionMonths);
  const cutoff = cutoffDate.toISOString();
  const deleted = db.transaction((tx) => ({
    health_events: tx.delete(healthEvents).where(lt(healthEvents.occurredAt, cutoff)).run().changes,
    level_changes: tx.delete(levelChanges).where(lt(levelChanges.createdAt, cutoff)).run().changes,
    audit_events: tx.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff)).run().changes,
    settings_history: tx.delete(settingsHistory).where(lt(settingsHistory.createdAt, cutoff)).run().changes,
  }));
  return { cutoff, deleted };
}
