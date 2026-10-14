import { CheckpointSchema, JobRecordSchema, RunRecordSchema, newId, type Checkpoint, type Clock, type EnqueueInput, type JobRecord, type RunRecord } from '@sctech/profilevault-contract';
import { jobs, runs, runSteps, type Database } from '@sctech/profilevault-db';
import { and, asc, eq } from 'drizzle-orm';

export class RunStore {
  constructor(readonly database: Database, private readonly clock: Clock) {}
  job(id: string): JobRecord | undefined {
    const row = this.database.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row && JobRecordSchema.parse({ ...row, result: row.resultJson ? JSON.parse(row.resultJson) as unknown : null, errorDetail: row.errorDetailJson ? JSON.parse(row.errorDetailJson) as unknown : null });
  }
  input(id: string): unknown { const row = this.database.db.select().from(jobs).where(eq(jobs.id, id)).get(); return row ? JSON.parse(row.inputJson) as unknown : undefined; }
  listJobs(filter: { status?: string; bindingId?: string; clientId?: string; limit?: number } = {}): JobRecord[] {
    return this.database.db.select({ id: jobs.id }).from(jobs).orderBy(asc(jobs.createdAt)).all().map((r) => this.job(r.id)!).filter((r) => (!filter.status || r.status === filter.status) && (!filter.bindingId || r.bindingId === filter.bindingId) && (!filter.clientId || r.clientId === filter.clientId)).slice(-(filter.limit ?? 500)).reverse();
  }
  run(id: string): RunRecord | undefined {
    const row = this.raw(id);
    return row && RunRecordSchema.parse({ ...row, needsUser: row.needsUserJson ? JSON.parse(row.needsUserJson) as unknown : null, errorDetail: row.errorDetailJson ? JSON.parse(row.errorDetailJson) as unknown : null, steps: this.database.db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.seq)).all(), input: this.input(row.jobId) });
  }
  runByJob(jobId: string): RunRecord | undefined { const row = this.database.db.select({ id: runs.id }).from(runs).where(eq(runs.jobId, jobId)).get(); return row ? this.run(row.id) : undefined; }
  jobByKey(clientId: string, key: string): JobRecord | undefined { const row = this.database.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.clientId, clientId), eq(jobs.idempotencyKey, key))).get(); return row ? this.job(row.id) : undefined; }
  raw(id: string) { return this.database.db.select().from(runs).where(eq(runs.id, id)).get(); }
  listRuns(): RunRecord[] { return this.database.db.select({ id: runs.id }).from(runs).orderBy(asc(runs.queuedAt), asc(runs.id)).all().map((r) => this.run(r.id)!); }
  checkpoint(id: string): Checkpoint { const raw = this.raw(id)?.checkpointJson; return CheckpointSchema.parse(raw ? JSON.parse(raw) as unknown : {}); }
  saveCheckpoint(id: string, checkpoint: Checkpoint): void { this.patchRun(id, { checkpointJson: JSON.stringify(CheckpointSchema.parse(checkpoint)) }); }
  patchRun(id: string, patch: Partial<typeof runs.$inferInsert>): void { this.database.db.update(runs).set(patch).where(eq(runs.id, id)).run(); }
  patchJob(id: string, patch: Partial<typeof jobs.$inferInsert>): void { this.database.db.update(jobs).set({ ...patch, updatedAt: this.clock.nowIso() }).where(eq(jobs.id, id)).run(); }
  step(runId: string, seq: number, patch: Omit<typeof runSteps.$inferInsert, 'runId' | 'seq'>): void {
    this.database.db.insert(runSteps).values({ runId, seq, ...patch }).onConflictDoUpdate({ target: [runSteps.runId, runSteps.seq], set: patch }).run();
  }
  enqueue(input: Required<EnqueueInput>, version: string): RunRecord {
    return this.database.sqlite.transaction(() => {
      const existing = this.database.db.select().from(jobs).where(and(eq(jobs.clientId, input.clientId), eq(jobs.idempotencyKey, input.idempotencyKey))).get();
      if (existing) return this.listRuns().find((r) => r.jobId === existing.id)!;
      const now = this.clock.nowIso(); const jobId = newId('job', this.clock.nowMs()); const runId = newId('run', this.clock.nowMs());
      this.database.db.insert(jobs).values({ id: jobId, clientId: input.clientId, flowId: input.flowId, bindingId: input.bindingId, idempotencyKey: input.idempotencyKey, inputJson: JSON.stringify(input.input), mode: input.mode, status: 'queued', createdAt: now, updatedAt: now }).run();
      this.database.db.insert(runs).values({ id: runId, jobId, bindingId: input.bindingId, flowId: input.flowId, flowVersion: version, status: 'queued', queuedAt: now, checkpointJson: JSON.stringify(CheckpointSchema.parse({})) }).run();
      return this.run(runId)!;
    })();
  }
}
