import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { PvError, systemClock, type Clock } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { settings, settingsHistory } from '../schema.js';

export interface SettingsHistoryRow {
  id: number;
  key: string;
  oldJson: string | null;
  newJson: string;
  actor: string;
  createdAt: string;
}

/** Bảng `settings` + `settings_history` (SPEC-00 §8): mọi thay đổi có lịch sử và `actor`. */
export class SettingsRepo {
  constructor(
    private readonly db: DrizzleDb,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Đọc giá trị; `schema` tùy chọn để kiểm/khớp kiểu. Không có → `undefined`. */
  get<T = unknown>(key: string, schema?: z.ZodType<T>): T | undefined {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return undefined;
    const parsed: unknown = JSON.parse(row.valueJson);
    if (!schema) return parsed as T;
    const r = schema.safeParse(parsed);
    if (!r.success) {
      throw new PvError('INTERNAL', `settings.${key} không khớp schema`, {
        reason: 'settings_invalid',
        key,
        issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }

  has(key: string): boolean {
    return this.db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).get() !== undefined;
  }

  /** Ghi giá trị và dòng lịch sử trong một giao dịch. */
  set(key: string, value: unknown, actor: string): void {
    const newJson = JSON.stringify(value);
    const now = this.clock.nowIso();
    this.db.transaction((tx) => {
      const old = tx.select().from(settings).where(eq(settings.key, key)).get();
      if (old && old.valueJson === newJson) return;
      tx.insert(settings)
        .values({ key, valueJson: newJson, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson: newJson, updatedAt: now } })
        .run();
      tx.insert(settingsHistory)
        .values({ key, oldJson: old?.valueJson ?? null, newJson, actor, createdAt: now })
        .run();
    });
  }

  /** Lịch sử mới nhất trước. */
  history(key: string, limit = 100): SettingsHistoryRow[] {
    return this.db
      .select()
      .from(settingsHistory)
      .where(eq(settingsHistory.key, key))
      .orderBy(desc(settingsHistory.id))
      .limit(limit)
      .all();
  }

  keys(): string[] {
    return this.db
      .select({ key: settings.key })
      .from(settings)
      .all()
      .map((r) => r.key);
  }
}
