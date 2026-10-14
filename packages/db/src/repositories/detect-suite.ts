import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { DrizzleDb } from '../open.js';
import { detectSuiteResults } from '../schema.js';

export interface DetectSuiteRow {
  id: number;
  furyVersion: string;
  bindingId: string | null;
  passed: boolean;
  summary: string | null;
  recordedAt: string;
}

export class DetectSuiteRepo {
  constructor(private readonly db: DrizzleDb) {}

  insert(r: Omit<DetectSuiteRow, 'id'>): DetectSuiteRow {
    const res = this.db.insert(detectSuiteResults).values(r).run();
    return { id: Number(res.lastInsertRowid), ...r };
  }

  /** Kết quả gần nhất áp cho (phiên bản, binding): bản ghi theo binding hoặc toàn cục, mới nhất thắng. */
  latestFor(furyVersion: string, bindingId?: string): DetectSuiteRow | undefined {
    const scope = bindingId ? or(isNull(detectSuiteResults.bindingId), eq(detectSuiteResults.bindingId, bindingId)) : isNull(detectSuiteResults.bindingId);
    const r = this.db
      .select()
      .from(detectSuiteResults)
      .where(and(eq(detectSuiteResults.furyVersion, furyVersion), scope))
      .orderBy(desc(detectSuiteResults.recordedAt), desc(detectSuiteResults.id))
      .get();
    return r ?? undefined;
  }

  /** Có kết quả `passed` còn hiệu lực cho phiên bản (SPEC-02 §3.2 `detect_suite_pass`, R5). */
  hasPassed(furyVersion: string, bindingId?: string): boolean {
    return this.latestFor(furyVersion, bindingId)?.passed === true;
  }

  list(limit = 100): DetectSuiteRow[] {
    return this.db.select().from(detectSuiteResults).orderBy(desc(detectSuiteResults.recordedAt), desc(detectSuiteResults.id)).limit(limit).all();
  }
}
