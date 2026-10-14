import { and, eq, isNull } from 'drizzle-orm';
import type { AutomationLevel, Binding } from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { bindings } from '../schema.js';

type Row = typeof bindings.$inferSelect;

function toBinding(r: Row): Binding {
  return {
    id: r.id,
    platform: r.platform,
    accountId: r.accountId,
    displayName: r.displayName,
    furyProfileId: r.furyProfileId,
    marketCountry: r.marketCountry,
    packConfig: JSON.parse(r.packConfigJson) as Record<string, unknown>,
    allowedRoots: JSON.parse(r.allowedRootsJson) as string[],
    level: r.level as AutomationLevel,
    levelSince: r.levelSince,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
  };
}

export class BindingsRepo {
  constructor(private readonly db: DrizzleDb) {}

  insert(b: Binding): void {
    this.db
      .insert(bindings)
      .values({
        id: b.id,
        platform: b.platform,
        accountId: b.accountId,
        displayName: b.displayName,
        furyProfileId: b.furyProfileId,
        marketCountry: b.marketCountry,
        packConfigJson: JSON.stringify(b.packConfig),
        allowedRootsJson: JSON.stringify(b.allowedRoots),
        level: b.level,
        levelSince: b.levelSince,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        archivedAt: b.archivedAt,
      })
      .run();
  }

  update(
    id: string,
    patch: Partial<Pick<Binding, 'displayName' | 'marketCountry' | 'packConfig' | 'allowedRoots'>>,
    updatedAt: string,
  ): void {
    const set: Partial<typeof bindings.$inferInsert> = { updatedAt };
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.marketCountry !== undefined) set.marketCountry = patch.marketCountry;
    if (patch.packConfig !== undefined) set.packConfigJson = JSON.stringify(patch.packConfig);
    if (patch.allowedRoots !== undefined) set.allowedRootsJson = JSON.stringify(patch.allowedRoots);
    this.db.update(bindings).set(set).where(eq(bindings.id, id)).run();
  }

  setLevel(id: string, level: AutomationLevel, levelSince: string): void {
    this.db.update(bindings).set({ level, levelSince, updatedAt: levelSince }).where(eq(bindings.id, id)).run();
  }

  archive(id: string, at: string): void {
    this.db.update(bindings).set({ archivedAt: at, updatedAt: at }).where(eq(bindings.id, id)).run();
  }

  get(id: string): Binding | undefined {
    const r = this.db.select().from(bindings).where(eq(bindings.id, id)).get();
    return r ? toBinding(r) : undefined;
  }

  getByProfile(furyProfileId: string): Binding | undefined {
    const r = this.db.select().from(bindings).where(eq(bindings.furyProfileId, furyProfileId)).get();
    return r ? toBinding(r) : undefined;
  }

  getByAccount(platform: string, accountId: string): Binding | undefined {
    const r = this.db
      .select()
      .from(bindings)
      .where(and(eq(bindings.platform, platform), eq(bindings.accountId, accountId)))
      .get();
    return r ? toBinding(r) : undefined;
  }

  list(opts: { includeArchived?: boolean } = {}): Binding[] {
    const q = this.db.select().from(bindings);
    const rows = opts.includeArchived ? q.all() : q.where(isNull(bindings.archivedAt)).all();
    return rows.map(toBinding).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
