import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type {
  AsnType,
  ConsistencyResultRow,
  HostSnapshot,
  NormalizedProbe,
  ProbeResult,
  RuleConfig,
  RuleLayer,
  RuleStatus,
  Severity,
} from '@sctech/profilevault-contract';
import type { DrizzleDb } from '../open.js';
import { accountChecklists, asnAttestations, consistencyResults, consistencyRules, consistencyRuns, hostSnapshots, probeResults } from '../schema.js';

// ---- probe_results ----

function toProbe(r: typeof probeResults.$inferSelect): ProbeResult {
  return {
    id: r.id,
    bindingId: r.bindingId,
    furyVersion: r.furyVersion,
    source: r.source as 'manual_import' | 'flow',
    capturedAt: r.capturedAt,
    data: JSON.parse(r.dataJson) as NormalizedProbe,
    rawPath: r.rawPath,
    createdAt: r.createdAt,
  };
}

export class ProbeResultsRepo {
  constructor(private readonly db: DrizzleDb) {}

  insert(p: ProbeResult): void {
    this.db
      .insert(probeResults)
      .values({ id: p.id, bindingId: p.bindingId, furyVersion: p.furyVersion, source: p.source, capturedAt: p.capturedAt, dataJson: JSON.stringify(p.data), rawPath: p.rawPath, createdAt: p.createdAt })
      .run();
  }

  /** Gần nhất và liền trước (theo `captured_at`). */
  latestTwo(bindingId: string): [ProbeResult | undefined, ProbeResult | undefined] {
    const rows = this.db.select().from(probeResults).where(eq(probeResults.bindingId, bindingId)).orderBy(desc(probeResults.capturedAt), desc(probeResults.id)).limit(2).all();
    return [rows[0] ? toProbe(rows[0]) : undefined, rows[1] ? toProbe(rows[1]) : undefined];
  }

  list(bindingId: string, limit = 50): ProbeResult[] {
    return this.db.select().from(probeResults).where(eq(probeResults.bindingId, bindingId)).orderBy(desc(probeResults.capturedAt), desc(probeResults.id)).limit(limit).all().map(toProbe);
  }

  get(id: string): ProbeResult | undefined {
    const r = this.db.select().from(probeResults).where(eq(probeResults.id, id)).get();
    return r ? toProbe(r) : undefined;
  }
}

// ---- account_checklists ----

export type ChecklistRow = typeof accountChecklists.$inferSelect;

export class ChecklistsRepo {
  constructor(private readonly db: DrizzleDb) {}

  get(bindingId: string): ChecklistRow | undefined {
    return this.db.select().from(accountChecklists).where(eq(accountChecklists.bindingId, bindingId)).get() ?? undefined;
  }

  upsert(row: Partial<Omit<ChecklistRow, 'bindingId' | 'updatedAt'>> & { bindingId: string; updatedAt: string }): ChecklistRow {
    const existing = this.get(row.bindingId);
    if (existing) {
      const { bindingId, ...rest } = row;
      this.db.update(accountChecklists).set(rest).where(eq(accountChecklists.bindingId, bindingId)).run();
    } else {
      this.db.insert(accountChecklists).values(row).run();
    }
    return this.get(row.bindingId)!;
  }

  listAll(): ChecklistRow[] {
    return this.db.select().from(accountChecklists).all();
  }

  /** Hết hạn trong khoảng [from, to]. */
  expiringBetween(from: string, to: string): ChecklistRow[] {
    return this.db
      .select()
      .from(accountChecklists)
      .where(and(gte(accountChecklists.expiresAt, from), lte(accountChecklists.expiresAt, to)))
      .all();
  }
}

// ---- host_snapshots ----

export class HostSnapshotsRepo {
  constructor(private readonly db: DrizzleDb) {}

  insert(h: HostSnapshot): void {
    this.db.insert(hostSnapshots).values({ os: h.os, osVersion: h.osVersion, gpusJson: JSON.stringify(h.gpus), displaysJson: JSON.stringify(h.displays), ramMb: h.ramMb, capturedAt: h.capturedAt }).run();
  }

  latest(): HostSnapshot | undefined {
    const r = this.db.select().from(hostSnapshots).orderBy(desc(hostSnapshots.capturedAt), desc(hostSnapshots.id)).get();
    if (!r) return undefined;
    return { os: r.os, osVersion: r.osVersion, gpus: JSON.parse(r.gpusJson) as HostSnapshot['gpus'], displays: JSON.parse(r.displaysJson) as HostSnapshot['displays'], ramMb: r.ramMb, capturedAt: r.capturedAt };
  }
}

// ---- consistency_rules ----

function toRule(r: typeof consistencyRules.$inferSelect): RuleConfig {
  return { id: r.id, layer: r.layer as RuleLayer, severity: r.severity as Severity, enabled: r.enabled, params: JSON.parse(r.paramsJson) as Record<string, unknown>, updatedAt: r.updatedAt };
}

export class ConsistencyRulesRepo {
  constructor(private readonly db: DrizzleDb) {}

  upsert(rule: RuleConfig): void {
    this.db
      .insert(consistencyRules)
      .values({ id: rule.id, layer: rule.layer, severity: rule.severity, enabled: rule.enabled, paramsJson: JSON.stringify(rule.params), updatedAt: rule.updatedAt })
      .onConflictDoUpdate({ target: consistencyRules.id, set: { severity: rule.severity, enabled: rule.enabled, paramsJson: JSON.stringify(rule.params), updatedAt: rule.updatedAt } })
      .run();
  }

  get(id: string): RuleConfig | undefined {
    const r = this.db.select().from(consistencyRules).where(eq(consistencyRules.id, id)).get();
    return r ? toRule(r) : undefined;
  }

  list(): RuleConfig[] {
    return this.db.select().from(consistencyRules).orderBy(consistencyRules.id).all().map(toRule);
  }

  count(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(consistencyRules).get()?.n ?? 0;
  }
}

// ---- consistency_runs + results ----

export interface ConsistencyRunRow {
  id: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
}

function toResult(r: typeof consistencyResults.$inferSelect): ConsistencyResultRow {
  return {
    runId: r.runId,
    bindingId: r.bindingId,
    ruleId: r.ruleId,
    status: r.status as RuleStatus,
    severity: r.severity as Severity,
    actual: r.actualJson === null ? undefined : (JSON.parse(r.actualJson) as unknown),
    expected: r.expectedJson === null ? undefined : (JSON.parse(r.expectedJson) as unknown),
    hint: r.hint,
  };
}

export class ConsistencyRunsRepo {
  constructor(private readonly db: DrizzleDb) {}

  start(id: string, trigger: string, startedAt: string): void {
    this.db.insert(consistencyRuns).values({ id, trigger, startedAt, finishedAt: null }).run();
  }

  finish(id: string, finishedAt: string): void {
    this.db.update(consistencyRuns).set({ finishedAt }).where(eq(consistencyRuns.id, id)).run();
  }

  addResults(rows: ConsistencyResultRow[]): void {
    if (rows.length === 0) return;
    this.db
      .insert(consistencyResults)
      .values(
        rows.map((r) => ({
          runId: r.runId,
          bindingId: r.bindingId,
          ruleId: r.ruleId,
          status: r.status,
          severity: r.severity,
          actualJson: r.actual === undefined ? null : JSON.stringify(r.actual),
          expectedJson: r.expected === undefined ? null : JSON.stringify(r.expected),
          hint: r.hint,
        })),
      )
      .run();
  }

  get(id: string): ConsistencyRunRow | undefined {
    return this.db.select().from(consistencyRuns).where(eq(consistencyRuns.id, id)).get() ?? undefined;
  }

  /** Lần kiểm gần nhất (đã xong) có kết quả cho binding. */
  latestForBinding(bindingId: string): { run: ConsistencyRunRow; results: ConsistencyResultRow[] } | undefined {
    const row = this.db
      .select({ run: consistencyRuns })
      .from(consistencyRuns)
      .innerJoin(consistencyResults, eq(consistencyResults.runId, consistencyRuns.id))
      .where(eq(consistencyResults.bindingId, bindingId))
      .orderBy(desc(consistencyRuns.startedAt), desc(consistencyRuns.id))
      .limit(1)
      .get();
    if (!row) return undefined;
    const results = this.db
      .select()
      .from(consistencyResults)
      .where(and(eq(consistencyResults.runId, row.run.id), eq(consistencyResults.bindingId, bindingId)))
      .all()
      .map(toResult);
    return { run: row.run, results };
  }

  results(runId: string, bindingIds?: string[]): ConsistencyResultRow[] {
    const base = this.db.select().from(consistencyResults);
    const q = bindingIds && bindingIds.length > 0 ? base.where(and(eq(consistencyResults.runId, runId), inArray(consistencyResults.bindingId, bindingIds))) : base.where(eq(consistencyResults.runId, runId));
    return q.all().map(toResult);
  }

  listRuns(limit = 50): ConsistencyRunRow[] {
    return this.db.select().from(consistencyRuns).orderBy(desc(consistencyRuns.startedAt), desc(consistencyRuns.id)).limit(limit).all();
  }
}

// ---- asn_attestations ----

export interface AsnAttestationRow {
  asn: number;
  asnType: AsnType;
  note: string | null;
  createdAt: string;
}

export class AsnAttestationsRepo {
  constructor(private readonly db: DrizzleDb) {}

  upsert(row: AsnAttestationRow): void {
    this.db
      .insert(asnAttestations)
      .values(row)
      .onConflictDoUpdate({ target: asnAttestations.asn, set: { asnType: row.asnType, note: row.note, createdAt: row.createdAt } })
      .run();
  }

  get(asn: number): AsnAttestationRow | undefined {
    const r = this.db.select().from(asnAttestations).where(eq(asnAttestations.asn, asn)).get();
    return r ? { asn: r.asn, asnType: r.asnType as AsnType, note: r.note, createdAt: r.createdAt } : undefined;
  }

  list(): AsnAttestationRow[] {
    return this.db.select().from(asnAttestations).all().map((r) => ({ asn: r.asn, asnType: r.asnType as AsnType, note: r.note, createdAt: r.createdAt }));
  }
}
