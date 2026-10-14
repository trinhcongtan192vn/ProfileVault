import { and, asc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { DrizzleDb } from '@sctech/profilevault-db';
import { consistencyResults, consistencyRuns, healthEvents, levelChanges, proxyChecks, runs } from '@sctech/profilevault-db';

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV UTF-8 có BOM, CRLF (mở được trong Excel). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export interface ExportFilter {
  bindingId?: string;
  from?: string;
  to?: string;
}

export function exportDataset(db: DrizzleDb, dataset: string, f: ExportFilter): { columns: string[]; rows: Record<string, unknown>[] } {
  switch (dataset) {
    case 'events': {
      const c: SQL[] = [];
      if (f.bindingId) c.push(eq(healthEvents.bindingId, f.bindingId));
      if (f.from) c.push(gte(healthEvents.occurredAt, f.from));
      if (f.to) c.push(lte(healthEvents.occurredAt, f.to));
      const base = db.select().from(healthEvents);
      const rows = (c.length ? base.where(and(...c)) : base).orderBy(asc(healthEvents.occurredAt)).all();
      return { columns: ['id', 'binding_id', 'type', 'severity', 'source', 'occurred_at', 'recorded_at', 'payload_json'], rows: rows.map((r) => ({ id: r.id, binding_id: r.bindingId, type: r.type, severity: r.severity, source: r.source, occurred_at: r.occurredAt, recorded_at: r.recordedAt, payload_json: r.payloadJson })) };
    }
    case 'proxy_checks': {
      const c: SQL[] = [];
      if (f.bindingId) c.push(eq(proxyChecks.bindingId, f.bindingId));
      if (f.from) c.push(gte(proxyChecks.checkedAt, f.from));
      if (f.to) c.push(lte(proxyChecks.checkedAt, f.to));
      const base = db.select().from(proxyChecks);
      const rows = (c.length ? base.where(and(...c)) : base).orderBy(asc(proxyChecks.checkedAt)).all();
      return { columns: ['id', 'binding_id', 'ok', 'exit_ip', 'country', 'city', 'timezone', 'asn', 'asn_org', 'asn_type', 'latency_ms', 'error', 'checked_at'], rows: rows.map((r) => ({ id: r.id, binding_id: r.bindingId, ok: r.ok ? 1 : 0, exit_ip: r.exitIp, country: r.country, city: r.city, timezone: r.timezone, asn: r.asn, asn_org: r.asnOrg, asn_type: r.asnType, latency_ms: r.latencyMs, error: r.error, checked_at: r.checkedAt })) };
    }
    case 'runs': {
      const c: SQL[] = [];
      if (f.bindingId) c.push(eq(runs.bindingId, f.bindingId));
      if (f.from) c.push(gte(runs.queuedAt, f.from));
      if (f.to) c.push(lte(runs.queuedAt, f.to));
      const base = db.select().from(runs);
      const rows = (c.length ? base.where(and(...c)) : base).orderBy(asc(runs.queuedAt)).all();
      return { columns: ['id', 'job_id', 'binding_id', 'flow_id', 'flow_version', 'status', 'current_step', 'attempt', 'queued_at', 'started_at', 'finished_at', 'error_code'], rows: rows.map((r) => ({ id: r.id, job_id: r.jobId, binding_id: r.bindingId, flow_id: r.flowId, flow_version: r.flowVersion, status: r.status, current_step: r.currentStep, attempt: r.attempt, queued_at: r.queuedAt, started_at: r.startedAt, finished_at: r.finishedAt, error_code: r.errorCode })) };
    }
    case 'level_changes': {
      const c: SQL[] = [];
      if (f.bindingId) c.push(eq(levelChanges.bindingId, f.bindingId));
      if (f.from) c.push(gte(levelChanges.createdAt, f.from));
      if (f.to) c.push(lte(levelChanges.createdAt, f.to));
      const base = db.select().from(levelChanges);
      const rows = (c.length ? base.where(and(...c)) : base).orderBy(asc(levelChanges.createdAt)).all();
      return { columns: ['id', 'binding_id', 'from_level', 'to_level', 'kind', 'reason', 'actor', 'created_at', 'detail_json'], rows: rows.map((r) => ({ id: r.id, binding_id: r.bindingId, from_level: r.fromLevel, to_level: r.toLevel, kind: r.kind, reason: r.reason, actor: r.actor, created_at: r.createdAt, detail_json: r.detailJson })) };
    }
    case 'consistency_results': {
      const c: SQL[] = [];
      if (f.bindingId) c.push(eq(consistencyResults.bindingId, f.bindingId));
      if (f.from) c.push(gte(consistencyRuns.startedAt, f.from));
      if (f.to) c.push(lte(consistencyRuns.startedAt, f.to));
      const base = db.select({ r: consistencyResults, run: consistencyRuns }).from(consistencyResults).innerJoin(consistencyRuns, eq(consistencyRuns.id, consistencyResults.runId));
      const rows = (c.length ? base.where(and(...c)) : base).orderBy(asc(consistencyRuns.startedAt)).all();
      return { columns: ['run_id', 'trigger', 'started_at', 'binding_id', 'rule_id', 'status', 'severity', 'actual_json', 'expected_json', 'hint'], rows: rows.map(({ r, run }) => ({ run_id: r.runId, trigger: run.trigger, started_at: run.startedAt, binding_id: r.bindingId, rule_id: r.ruleId, status: r.status, severity: r.severity, actual_json: r.actualJson, expected_json: r.expectedJson, hint: r.hint })) };
    }
    default:
      return { columns: [], rows: [] };
  }
}
