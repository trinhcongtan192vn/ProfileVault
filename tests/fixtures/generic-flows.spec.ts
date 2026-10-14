import { test, expect, type Page } from '@playwright/test';
import { FakeTimers } from '../../packages/fury-client/dist/index.js';
import { openAndWait, probe, readPage } from '../../packs/generic/dist/index.js';
import { SafeUi, type FlowContext } from '../../packages/runner/dist/index.js';
import { PvError, type Binding, type GateResult, type HumanGate } from '../../packages/contract/dist/index.js';

/** Flow generic M1 trên trang giả lập (SPEC-04 §2.3–2.5). */
const binding: Binding = { id: 'ab_01K7E4R0000000000000000001', platform: 'youtube', accountId: 'UCEXPECTED', displayName: 'Fixture', furyProfileId: 'p1', marketCountry: 'VN', packConfig: { studioLanguage: 'en' }, allowedRoots: [], level: 1, levelSince: '2026-10-14T00:00:00Z', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null };

function ctxFor<I>(page: Page, input: I, sites: string[], extra: { probeUrl?: string; gate?: (g: HumanGate) => GateResult } = {}): FlowContext<I> {
  return {
    input, mode: null, binding, page, state: {}, fury: extra.probeUrl ? { probeUrl: extra.probeUrl } : {},
    ui: new SafeUi({ page, sites, timers: new FakeTimers() }),
    step: async (_n, fn) => fn(),
    humanGate: async (g) => (extra.gate ? extra.gate(g) : { choice: 'done', resolvedAt: new Date().toISOString() }),
    fail: (code, message, detail) => { throw new PvError(code, message, detail); },
    log() {},
    artifact: async () => '',
  };
}

test('generic/probe: mở trang probe của Fury (relay loopback), đọc window.furyProbe()', async ({ page }) => {
  const url = 'http://127.0.0.1:51834/tok/probe/';
  await page.route('http://127.0.0.1:51834/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script>window.furyProbe = async () => ({ __schema: 1, __probeVersion: "0.3.0", navigator: { platform: "Win32" }, locale: { timezone: "Asia/Bangkok" }, screen: { width: 1920 } });</script>' }));
  const out = await probe.run(ctxFor(page, {}, ['127.0.0.1'], { probeUrl: url }));
  expect(out.raw).toMatchObject({ __schema: 1, locale: { timezone: 'Asia/Bangkok' } });
  await expect(probe.run(ctxFor(page, {}, ['127.0.0.1']))).rejects.toMatchObject({ code: 'FURY_CAPABILITY_MISSING' });
  // Trang probe lạ → SITE_CHANGED
  await page.route('http://127.0.0.1:51835/**', (route) => route.fulfill({ contentType: 'text/html', body: '<script>window.furyProbe = async () => ({ hello: 1 });</script>' }));
  await expect(probe.run(ctxFor(page, {}, ['127.0.0.1'], { probeUrl: 'http://127.0.0.1:51835/x/probe/' }))).rejects.toMatchObject({ code: 'SITE_CHANGED' });
});

test('generic/read-page: đọc theo locator, thiếu → null; URL ngoài domain nền tảng → FORBIDDEN_ACTION', async ({ page }) => {
  await page.route('https://studio.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Channel content</h1><a id="video-title">Video A</a><button>Create</button>' }));
  const out = await readPage.run(ctxFor(page, { url: 'https://studio.youtube.com/channel/UCEXPECTED/videos', fields: [{ name: 'heading', locator: { role: 'heading', name: 'Channel content' } }, { name: 'first', locator: { css: '#video-title' } }, { name: 'missing', locator: { text: 'Không có' } }] }, ['studio.youtube.com']));
  expect(out.values).toEqual({ heading: 'Channel content', first: 'Video A', missing: null });
  await expect(readPage.run(ctxFor(page, { url: 'https://example.com/', fields: [{ name: 'x', locator: { css: 'h1' } }] }, ['studio.youtube.com']))).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION' });
});

test('generic/open-and-wait: mở trang rồi chờ người (giữ profile mở)', async ({ page }) => {
  await page.route('https://studio.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Studio</h1>' }));
  const gates: HumanGate[] = [];
  const out = await openAndWait.run(ctxFor(page, { url: 'https://studio.youtube.com/', message: 'Kiểm tra cài đặt kênh' }, ['studio.youtube.com'], { gate: (g) => { gates.push(g); return { choice: 'done', note: 'ok', resolvedAt: new Date().toISOString() }; } }));
  expect(out).toEqual({ choice: 'done', note: 'ok' });
  expect(gates).toEqual([expect.objectContaining({ reason: 'custom', keepProfileOpen: true, message: 'Kiểm tra cài đặt kênh' })]);
});
