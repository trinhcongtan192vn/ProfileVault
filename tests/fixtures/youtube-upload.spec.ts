import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { FakeTimers } from '../../packages/fury-client/dist/index.js';
import { upload, isRecent, videoIdFrom } from '../../packs/youtube/dist/index.js';
import { SafeUi, type FlowContext } from '../../packages/runner/dist/index.js';
import { PvError, StepOptionsSchema, type Binding, type GateResult, type HumanGate, type YoutubeUploadInput } from '../../packages/contract/dist/index.js';

/** Flow youtube/upload trên trang Studio giả lập (SPEC-04 §6, SPEC-09 §3.3; AT-M1-3, AT-M1-6). */
const FIXTURE = readFileSync(path.resolve('packs/youtube/flows/upload/test/fixtures/studio-upload.html'), 'utf8');
const FORBIDDEN = JSON.parse(readFileSync(path.resolve('packs/youtube/data/forbidden.json'), 'utf8')) as string[];
const SITES = ['studio.youtube.com', 'www.youtube.com', 'accounts.google.com'];
const binding: Binding = { id: 'ab_01K7E4R0000000000000000001', platform: 'youtube', accountId: 'UCEXPECTED', displayName: 'Fixture', furyProfileId: 'p1', marketCountry: 'VN', packConfig: { studioLanguage: 'en' }, allowedRoots: [], level: 3, levelSince: '2026-10-14T00:00:00Z', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null };

interface Scenario {
  mode?: 'L2' | 'L3';
  studioTarget?: string;
  fixture?: Record<string, unknown>;
  gate?: (g: HumanGate, page: Page) => Promise<string> | string;
  input?: Partial<YoutubeUploadInput>;
  afterVerify?: (files: Record<string, string>) => void;
}

let dir: string;
test.beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'pv-upload-')); });
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string) {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return { path: p, sha256: createHash('sha256').update(content).digest('hex') };
}

async function runUpload(page: Page, s: Scenario) {
  const fixtureJson = JSON.stringify(s.fixture ?? {});
  await page.route('https://studio.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: FIXTURE.replace('/*FIXTURE*/', `window.__FIXTURE__ = ${fixtureJson};`) }));
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
  const video = file('My video.mp4', 'video-bytes');
  const input = YoutubeInput({ video, ...s.input });
  const verified = Object.fromEntries([input.video, input.thumbnail, ...(input.captions ?? [])].filter((f): f is { path: string; sha256: string } => !!f).map((f) => [f.path, f.sha256]));
  s.afterVerify?.(verified);
  const gates: HumanGate[] = [];
  const target = s.studioTarget ?? 'https://studio.youtube.com/channel/UCEXPECTED';
  // Giả lập chuyển hướng của Studio (studio.youtube.com/ → /channel/<id> hoặc trang đăng nhập)
  const ui = new class extends SafeUi {
    override async goto(url: string): Promise<void> { await super.goto(url === 'https://studio.youtube.com/' ? target : url); }
  }({ page, sites: SITES, forbidden: FORBIDDEN, timers: new FakeTimers(), verifiedFiles: verified });
  const mode = s.mode ?? 'L3';
  const humanGate = async (g: HumanGate): Promise<GateResult> => {
    gates.push(g);
    const choice = s.gate ? await s.gate(g, page) : 'continue';
    if (choice === 'cancel') throw new PvError('CANCELLED', 'Người hủy');
    return { choice, resolvedAt: new Date().toISOString() };
  };
  const ctx: FlowContext<YoutubeUploadInput> = {
    input, mode, binding, page, state: {}, ui, humanGate, fury: {},
    // Như Runner: ở L2 bước final không chạy, thay bằng gate review_before_final
    step: async (_name, fn, opts) => {
      const o = StepOptionsSchema.parse(opts ?? {});
      if (o.final && mode === 'L2') {
        await humanGate({ reason: 'review_before_final', message: 'Kiểm tra và bấm Save', choices: [{ id: 'done_correct', label: 'Đúng' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: true });
        return undefined as never;
      }
      return fn();
    },
    fail: (code, message, detail) => { throw new PvError(code, message, detail); },
    log() {},
    artifact: async () => '',
  };
  return { result: upload.run(ctx), gates, saved: () => page.evaluate(() => (JSON.parse(localStorage.getItem('videos') ?? '[]') as unknown[]).length) };
}

function YoutubeInput(o: Partial<YoutubeUploadInput> & { video: { path: string; sha256: string } }): YoutubeUploadInput {
  return { title: 'My video', description: 'Mô tả thử', madeForKids: false, ...o };
}

test('L3: chạy đủ 11 bước, Private, đọc lại tiêu đề; playlist thiếu → cảnh báo; thumbnail + phụ đề + tag + ngôn ngữ', async ({ page }) => {
  const thumb = file('thumb.png', 'png');
  const subs = file('subs.vi.srt', '1\n00:00:00,000 --> 00:00:01,000\nXin chào\n');
  const r = await runUpload(page, { input: { thumbnail: thumb, captions: [{ ...subs, language: 'vi' }], playlistNames: ['Tutorials', 'Missing'], tags: ['a', 'b'], videoLanguage: 'Vietnamese', alteredContent: false } });
  await expect(r.result).resolves.toEqual({ videoId: 'FIXVIDEO01', studioUrl: 'https://studio.youtube.com/video/FIXVIDEO01/edit', visibility: 'private', warnings: ["playlist 'Missing' không tồn tại, đã bỏ qua"] });
  expect(await r.saved()).toBe(1);
  expect(r.gates).toEqual([]);
});

test('L2: dừng trước Save, người bấm Save trong cửa sổ, flow đọc lại kết quả', async ({ page }) => {
  let human = 0;
  const r = await runUpload(page, {
    mode: 'L2',
    gate: async (g, p) => {
      expect(g.reason).toBe('review_before_final');
      expect(g.keepProfileOpen).toBe(true);
      await p.click('#save'); // người bấm
      human++;
      return 'done_correct';
    },
  });
  await expect(r.result).resolves.toMatchObject({ videoId: 'FIXVIDEO01', visibility: 'private' });
  expect(human).toBe(1);
  expect(await r.saved()).toBe(1); // chỉ người bấm, flow không bấm
});

test('trùng tiêu đề trong 7 ngày → gate duplicate_suspected; người hủy → không upload', async ({ page }) => {
  const r = await runUpload(page, { fixture: { existing: [{ id: 'OLD', title: 'My video', date: new Date(Date.now() - 2 * 86_400_000).toDateString(), visibility: 'Private' }] }, gate: () => 'cancel' });
  await expect(r.result).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(r.gates.map((g) => g.reason)).toEqual(['duplicate_suspected']);
  expect(await r.saved()).toBe(0);
});

test('phiên hết hạn → gate session_expired rồi SESSION_EXPIRED; sai kênh → WRONG_ACCOUNT', async ({ page }) => {
  const r = await runUpload(page, { studioTarget: 'https://accounts.google.com/signin', gate: () => 'handled' });
  await expect(r.result).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  expect(r.gates.map((g) => g.reason)).toEqual(['session_expired']);
  const w = await runUpload(page, { studioTarget: 'https://studio.youtube.com/channel/UCOTHER', gate: () => 'handled' });
  await expect(w.result).rejects.toMatchObject({ code: 'WRONG_ACCOUNT' });
});

test('nút cuối có chữ "Publish" → FORBIDDEN_ACTION, kèm videoId (AT-M1-6)', async ({ page }) => {
  const r = await runUpload(page, { fixture: { saveLabel: 'Publish' } });
  await expect(r.result).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION', detail: { videoId: 'FIXVIDEO01' } });
  expect(await r.saved()).toBe(0);
});

test('YouTube báo hết lượt upload → YOUTUBE_UPLOAD_LIMIT kèm videoId', async ({ page }) => {
  const r = await runUpload(page, { fixture: { uploadError: 'You have reached your daily upload limit' } });
  await expect(r.result).rejects.toMatchObject({ code: 'YOUTUBE_UPLOAD_LIMIT', detail: { videoId: 'FIXVIDEO01' } });
});

test('file đổi sau khi gửi job → FILE_CHANGED trước khi tải lên', async ({ page }) => {
  const r = await runUpload(page, { afterVerify: (files) => { for (const p of Object.keys(files)) writeFileSync(p, 'khac'); } });
  await expect(r.result).rejects.toMatchObject({ code: 'FILE_CHANGED' });
});

test('giao diện đổi (nút Next không chuyển bước) → lỗi timeout (Runner ánh xạ SITE_CHANGED)', async ({ page }) => {
  page.setDefaultTimeout(1500);
  const r = await runUpload(page, { fixture: { hideNext: true } });
  await expect(r.result).rejects.toThrow(/Timeout|timeout/);
});

test('hàm thuần: videoId từ link, ngày gần đây', () => {
  expect(videoIdFrom('https://youtu.be/AbC_123-xy')).toBe('AbC_123-xy');
  expect(videoIdFrom('https://www.youtube.com/watch?v=AbC_123-xy&t=1')).toBe('AbC_123-xy');
  expect(videoIdFrom('https://studio.youtube.com/video/AbC_123-xy/edit')).toBe('AbC_123-xy');
  const now = Date.parse('2026-10-15T00:00:00Z');
  expect(isRecent('Oct 14, 2026', now)).toBe(true);
  expect(isRecent('Sep 1, 2026', now)).toBe(false);
  expect(isRecent('không đọc được', now)).toBe(true);
});
