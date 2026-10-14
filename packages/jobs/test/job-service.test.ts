import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  FakeClock,
  FlowManifestSchema,
  PvError,
  ReadPageInputSchema,
  SessionCheckInputSchema,
  YoutubeUploadInputSchema,
  type Binding,
  type EnqueueInput,
  type FlowInfo,
  type JobRecord,
  type RunRecord,
} from '@sctech/profilevault-contract';
import { AuditRepo, openTestDatabase, type TestDatabase } from '@sctech/profilevault-db';
import type { HealthService } from '@sctech/profilevault-health';
import { DASHBOARD_CLIENT, JobService, type JobClient, type JobRunner } from '../src/index.js';

const NOW = '2026-10-15T03:00:00.000Z'; // 10:00 Asia/Bangkok
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const FLOWS = {
  'youtube/upload': { manifest: FlowManifestSchema.parse({ id: 'youtube/upload', version: '1.0.0', description: 'u', minLevel: 2, modes: ['L2', 'L3'], site: ['studio.youtube.com'], timeoutMinutes: 90, countsAsUpload: true }), input: YoutubeUploadInputSchema },
  'youtube/session-check': { manifest: FlowManifestSchema.parse({ id: 'youtube/session-check', version: '1.0.0', description: 's', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5 }), input: SessionCheckInputSchema },
  'generic/read-page': { manifest: FlowManifestSchema.parse({ id: 'generic/read-page', version: '1.0.0', description: 'r', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5 }), input: ReadPageInputSchema },
} as const;

class FakeRunner implements JobRunner {
  jobs: JobRecord[] = [];
  runs: RunRecord[] = [];
  disabled = new Set<string>();
  cancelled: string[] = [];
  constructor(private readonly clock: FakeClock) {}
  listFlows(): FlowInfo[] {
    return Object.values(FLOWS).map((f) => ({ id: f.manifest.id, version: f.manifest.version, minLevel: f.manifest.minLevel, modes: f.manifest.modes, countsAsUpload: f.manifest.countsAsUpload, status: this.disabled.has(f.manifest.id) ? 'disabled' : 'enabled' }));
  }
  getFlow(id: string) {
    return FLOWS[id as keyof typeof FLOWS];
  }
  async enqueue(i: EnqueueInput): Promise<RunRecord> {
    const n = this.jobs.length + 1;
    const now = this.clock.nowIso();
    const job: JobRecord = { id: `jb_${String(n).padStart(26, '0')}`, clientId: i.clientId ?? 'scheduler', flowId: i.flowId, bindingId: i.bindingId, idempotencyKey: i.idempotencyKey, mode: i.mode ?? null, status: 'queued', result: null, errorCode: null, errorDetail: null, createdAt: now, updatedAt: now };
    const run: RunRecord = { id: `rn_${String(n).padStart(26, '0')}`, jobId: job.id, bindingId: i.bindingId, flowId: i.flowId, flowVersion: '1.0.0', status: 'queued', currentStep: null, attempt: 1, needsUser: null, queuedAt: now, startedAt: null, finishedAt: null, errorCode: null, errorDetail: null, artifactsDir: null, steps: [] };
    this.jobs.push(job);
    this.runs.push(run);
    return run;
  }
  getJob(id: string) { return this.jobs.find((j) => j.id === id); }
  runForJob(jobId: string) { return this.runs.find((r) => r.jobId === jobId); }
  jobByKey(clientId: string, key: string) { return this.jobs.find((j) => j.clientId === clientId && j.idempotencyKey === key); }
  listJobs(f: { status?: string; bindingId?: string; clientId?: string }) {
    return this.jobs.filter((j) => (!f.status || j.status === f.status) && (!f.bindingId || j.bindingId === f.bindingId) && (!f.clientId || j.clientId === f.clientId));
  }
  async cancelRun(runId: string) { this.cancelled.push(runId); const r = this.runs.find((x) => x.id === runId)!; const j = this.getJob(r.jobId)!; j.status = 'cancelled'; j.errorCode = 'CANCELLED'; }
}

let dir: string;
let db: TestDatabase;
let clock: FakeClock;
let runner: FakeRunner;
let bindings: Binding[];
let pauses: Record<string, { reason: string }[]>;
let manualUploads: number;
let svc: JobService;

const ID = { l0: 'ab_00000000000000000000000000', l1: 'ab_00000000000000000000000001', l2: 'ab_00000000000000000000000002', l3: 'ab_00000000000000000000000003' } as const;
function binding(name: keyof typeof ID, level: 0 | 1 | 2 | 3, extra: Partial<Binding> = {}): Binding {
  const id = ID[name];
  return { id, platform: 'youtube', accountId: `UC${name}`, displayName: name, furyProfileId: `p-${id}`, marketCountry: 'VN', packConfig: { studioLanguage: 'en' }, allowedRoots: [path.join(dir, 'exports')], level, levelSince: NOW, createdAt: NOW, updatedAt: NOW, archivedAt: null, ...extra };
}

const APP: JobClient = { id: 'cl_app', scopes: ['accounts.read', 'jobs.read', 'jobs.write'], flowFilter: ['youtube/*'], bindingFilter: ['*'] };

function video(name = 'v1.mp4', content = 'video-bytes'): { path: string; sha256: string } {
  const p = path.join(dir, 'exports', name);
  writeFileSync(p, content);
  return { path: p, sha256: sha(content) };
}
const upload = (key: string, extra: Record<string, unknown> = {}) => ({ flowId: 'youtube/upload', account: { platform: 'youtube', accountId: 'UCl3' }, idempotencyKey: key, input: { video: video(), title: 'T', description: 'D', madeForKids: false, ...extra } });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return err instanceof PvError ? err.code : String(err);
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'pv-jobs-'));
  mkdirSync(path.join(dir, 'exports'));
  mkdirSync(path.join(dir, 'other'));
  db = openTestDatabase();
  clock = new FakeClock(NOW);
  runner = new FakeRunner(clock);
  bindings = [binding('l1', 1), binding('l2', 2), binding('l3', 3), binding('l0', 0)];
  pauses = {};
  manualUploads = 0;
  const health = {
    getBinding: (id: string) => bindings.find((b) => b.id === id),
    listBindings: () => bindings.filter((b) => !b.archivedAt),
    listPauses: (id: string) => pauses[id] ?? [],
    listEvents: (_id: string, f: { types?: string[]; since?: string }) => (f.types?.includes('manual.upload') ? Array.from({ length: manualUploads }, () => ({ occurredAt: NOW })) : []),
  } as unknown as HealthService;
  svc = new JobService({ clock, config: DEFAULT_CONFIG, audit: new AuditRepo(db.database.db, clock), health, runner });
});
afterEach(() => {
  db.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe('Job service — tiếp nhận (SPEC-06 §3)', () => {
  it('L3 → mode L3; L2 → mode L2; trùng idempotencyKey trả job cũ (duplicate)', async () => {
    const a = await svc.submit(upload('k1'), APP);
    expect(a).toMatchObject({ duplicate: false, job: { status: 'queued', mode: 'L3', account: { platform: 'youtube', accountId: 'UCl3' }, error: null, needsUser: null } });
    const again = await svc.submit(upload('k1'), APP);
    expect(again.duplicate).toBe(true);
    expect(again.job.id).toBe(a.job.id);
    expect(runner.jobs).toHaveLength(1);
    const b = await svc.submit({ ...upload('k2'), account: { platform: 'youtube', accountId: 'UCl2' } }, APP);
    expect(b.job.mode).toBe('L2');
  });

  it('thứ tự lỗi: schema, scope, bộ lọc flow, flow, binding, dừng, mức, input', async () => {
    expect(await code(svc.submit({ flowId: 'youtube/upload', idempotencyKey: 'x' } as never, APP))).toBe('INPUT_INVALID');
    expect(await code(svc.submit(upload('x'), { ...APP, scopes: ['jobs.read'] }))).toBe('FORBIDDEN_SCOPE');
    // client chỉ được youtube/* gửi generic/read-page → FORBIDDEN_SCOPE (SPEC-06 §9)
    expect(await code(svc.submit({ flowId: 'generic/read-page', bindingId: ID.l1, idempotencyKey: 'x', input: { url: 'https://studio.youtube.com/', fields: [{ name: 't', locator: { css: 'h1' } }] } }, APP))).toBe('FORBIDDEN_SCOPE');
    expect(await code(svc.submit({ ...upload('x'), flowId: 'youtube/nope' }, APP))).toBe('FLOW_NOT_FOUND');
    runner.disabled.add('youtube/upload');
    expect(await code(svc.submit(upload('x'), APP))).toBe('FLOW_DISABLED');
    runner.disabled.clear();
    expect(await code(svc.submit({ ...upload('x'), account: { platform: 'youtube', accountId: 'UCnone' } }, APP))).toBe('ACCOUNT_NOT_BOUND');
    pauses[ID.l3] = [{ reason: 'manual' }];
    expect(await code(svc.submit(upload('x'), APP))).toBe('BINDING_PAUSED');
    pauses[ID.l3] = [];
    expect(await code(svc.submit({ ...upload('x'), account: { platform: 'youtube', accountId: 'UCl1' } }, APP))).toBe('LEVEL_TOO_LOW');
    expect(await code(svc.submit({ flowId: 'youtube/session-check', bindingId: ID.l0, idempotencyKey: 'x' }, APP))).toBe('LEVEL_TOO_LOW');
    const bad = await svc.submit(upload('x', { title: '' }), APP).catch((e: unknown) => e as PvError);
    expect(bad).toMatchObject({ code: 'INPUT_INVALID' });
    expect((bad as PvError).detail?.issues).toEqual([expect.objectContaining({ path: 'title' })]);
    expect(runner.jobs).toHaveLength(0);
  });

  it('bộ lọc binding của client', async () => {
    expect(await code(svc.submit(upload('x'), { ...APP, bindingFilter: [ID.l2] }))).toBe('FORBIDDEN_SCOPE');
  });

  it('file: ngoài thư mục cho phép, không có, SHA-256 khác → FILE_NOT_ALLOWED / FILE_NOT_FOUND / FILE_CHANGED', async () => {
    const outside = path.join(dir, 'other', 'x.mp4');
    writeFileSync(outside, 'x');
    expect(await code(svc.submit(upload('a', { video: { path: outside, sha256: sha('x') } }), APP))).toBe('FILE_NOT_ALLOWED');
    expect(await code(svc.submit(upload('b', { video: { path: path.join(dir, 'exports', '..', 'other', 'x.mp4'), sha256: sha('x') } }), APP))).toBe('FILE_NOT_ALLOWED');
    expect(await code(svc.submit(upload('c', { video: { path: path.join(dir, 'exports', 'missing.mp4'), sha256: sha('x') } }), APP))).toBe('FILE_NOT_FOUND');
    expect(await code(svc.submit(upload('d', { video: { path: video().path, sha256: sha('khac') } }), APP))).toBe('FILE_CHANGED');
    expect(await code(svc.submit(upload('e', { video: { path: 'relative.mp4', sha256: sha('x') } }), APP))).toBe('FILE_NOT_ALLOWED');
    expect(await code(svc.submit(upload('f'), APP))).toBe('OK');
  });

  it('giới hạn upload/ngày: job + "Đã upload" tay tính chung; lần thứ 11 → DAILY_LIMIT_REACHED; flow không tính upload không bị chặn', async () => {
    manualUploads = 4;
    for (let i = 0; i < 6; i++) expect(await code(svc.submit(upload(`u${i}`), APP))).toBe('OK');
    expect(await code(svc.submit(upload('u11'), APP))).toBe('DAILY_LIMIT_REACHED');
    // job bị hủy không tính
    runner.jobs[0]!.status = 'cancelled';
    expect(await code(svc.submit(upload('u12'), APP))).toBe('OK');
    expect(await code(svc.submit({ flowId: 'youtube/session-check', bindingId: ID.l3, idempotencyKey: 's1' }, APP))).toBe('OK');
    // sang ngày mới (giờ địa phương) → đếm lại
    clock.advance(24 * 3_600_000);
    manualUploads = 0;
    for (let i = 0; i < 10; i++) expect(await code(svc.submit(upload(`n${i}`), APP))).toBe('OK');
    expect(await code(svc.submit(upload('n10'), APP))).toBe('DAILY_LIMIT_REACHED');
  });
});

describe('Job service — đọc, hủy, dạng API (SPEC-06 §5)', () => {
  it('chỉ thấy job của chính client; dashboard thấy mọi job; phân trang cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await svc.submit({ flowId: 'youtube/session-check', bindingId: ID.l3, idempotencyKey: `s${i}` }, APP);
      clock.advance(1000);
    }
    const mine = await svc.submit({ flowId: 'youtube/session-check', bindingId: ID.l2, idempotencyKey: 'd1' }, DASHBOARD_CLIENT);
    expect(await code(Promise.resolve().then(() => svc.get(mine.job.id, APP)))).toBe('INPUT_INVALID');
    expect(svc.get(mine.job.id, DASHBOARD_CLIENT).id).toBe(mine.job.id);
    const p1 = svc.list(APP, { limit: 2 });
    expect(p1.jobs.map((j) => j.id)).toEqual([runner.jobs[2]!.id, runner.jobs[1]!.id]);
    expect(p1.nextCursor).toBe(runner.jobs[1]!.id);
    const p2 = svc.list(APP, { limit: 2, cursor: p1.nextCursor! });
    expect(p2).toEqual({ jobs: [expect.objectContaining({ id: runner.jobs[0]!.id })], nextCursor: null });
    expect(svc.list(DASHBOARD_CLIENT, {}).jobs).toHaveLength(4);
    expect(svc.list(APP, { accountId: 'UCl2' }).jobs).toHaveLength(0);
  });

  it('needsUser không kèm lựa chọn; lỗi có mã + thông điệp; hủy qua runner', async () => {
    const { job } = await svc.submit(upload('g1'), APP);
    const run = runner.runs[0]!;
    run.status = 'needs_user';
    run.needsUser = { reason: 'review_before_final', message: 'Kiểm tra rồi bấm Save', choices: [{ id: 'done_correct', label: 'x' }], keepProfileOpen: true, since: NOW, expiresAt: '2026-10-16T03:00:00.000Z' };
    runner.jobs[0]!.status = 'needs_user';
    const api = svc.get(job.id, APP);
    expect(api.needsUser).toEqual({ reason: 'review_before_final', message: 'Kiểm tra rồi bấm Save', since: NOW, expiresAt: '2026-10-16T03:00:00.000Z' });
    expect(JSON.stringify(api)).not.toContain('done_correct');
    const cancelled = await svc.cancel(job.id, APP);
    expect(runner.cancelled).toEqual([run.id]);
    expect(cancelled).toMatchObject({ status: 'cancelled', error: { code: 'CANCELLED', message: 'Job đã bị hủy' } });
    expect(await code(svc.cancel(job.id, { ...APP, scopes: ['jobs.read'] }))).toBe('FORBIDDEN_SCOPE');
  });
});
