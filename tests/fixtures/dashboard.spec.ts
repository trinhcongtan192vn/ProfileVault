import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { bootstrap } from '../../apps/service/dist/bootstrap.js';
import { MemorySecretStore } from '../../packages/core/dist/index.js';
import { FakeTimers, HttpFuryClient } from '../../packages/fury-client/dist/index.js';
import { FakeFury } from '../../packages/fury-client/dist/testing/fake-fury.js';

test('dashboard: wizard 2 kênh, upload/undo/SSE, CAPTCHA, các trang và CSV', async ({ page }) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pv-dashboard-'));
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ gateway: { host: '127.0.0.1', port: 0 } }));
  const fake = new FakeFury(); await fake.start();
  fake.upsertProfile({ id: 'p1', name: 'Profile 1' }); fake.upsertProfile({ id: 'p2', name: 'Profile 2' });
  const timers = new FakeTimers();
  const ctx = await bootstrap({ env: { PV_APPDATA_DIR: dir, PV_LOCALAPPDATA_DIR: dir }, secretStore: new MemorySecretStore(), fury: new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, maxRetries: 0 }), timers, startBackground: false, listen: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(ctx.gateway.createOpenUrl());
    await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
    for (let n = 1; n <= 2; n++) {
      await page.goto(`${ctx.gatewayUrl}/bindings/new`);
      await page.getByRole('radio', { name: `(p${n})` }).click(); await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
      await page.getByLabel('ID tài khoản').fill(`UCFIXTURECHANNEL${n}`);
      await page.getByLabel('Tên hiển thị').fill(`Kênh fixture ${n}`); await page.getByLabel('Thị trường').fill('DE');
      await page.getByRole('button', { name: 'Tiếp', exact: true }).click(); await page.getByRole('button', { name: 'Gắn kênh (L0)', exact: true }).click();
      await expect(page.getByLabel('Vùng tài khoản')).toBeVisible();
      await page.getByRole('button', { name: 'Tiếp', exact: true }).click(); await page.getByRole('button', { name: 'Bỏ qua, làm sau' }).click();
      await page.getByRole('button', { name: 'Mở chi tiết kênh' }).click();
      await expect(page.getByRole('heading', { name: new RegExp(`Kênh fixture ${n}`) })).toBeVisible();
    }
    const binding = ctx.health.listBindings()[0]!;
    await page.goto(`${ctx.gatewayUrl}/bindings/${binding.id}`);
    await page.getByRole('button', { name: '+ Sự kiện', exact: true }).click(); await page.getByRole('menuitem', { name: 'Đã upload', exact: true }).click();
    await expect.poll(() => ctx.health.listEvents(binding.id, { types: ['manual.upload'] }).length).toBe(1);
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await expect.poll(() => ctx.health.listEvents(binding.id, { types: ['manual.note'] }).some((e) => !!e.payload.undoOf)).toBe(true);
    // Ghi từ service để kiểm SSE độc lập với mutation của trang.
    await ctx.health.recordManualEvent(binding.id, 'manual.note', undefined, 'SSE fixture');
    await expect(page.getByText(/SSE fixture/)).toBeVisible({ timeout: 2000 });
    await page.getByRole('button', { name: '+ Sự kiện', exact: true }).click(); await page.getByRole('menuitem', { name: /CAPTCHA/ }).click();
    await expect(page.getByText(/Kênh sẽ về L0/)).toBeVisible(); await page.getByRole('button', { name: 'Xác nhận và hạ về L0' }).click();
    await expect.poll(() => ctx.health.listEvents(binding.id, { types: ['manual.captcha'] }).length).toBe(1);
    for (const route of ['/inbox', '/jobs', '/system', '/schedules', '/settings']) { await page.goto(ctx.gatewayUrl + route); await expect(page.locator('main h1').first()).toBeVisible(); }
    const csv = await page.request.get(`${ctx.gatewayUrl}/internal/export/events.csv?bindingId=${binding.id}`);
    expect(csv.ok()).toBe(true); expect(await csv.text()).toContain('manual.upload');
    expect(ctx.runner.listFlows().filter((f) => f.status === 'enabled').map((f) => f.id).sort()).toEqual(['generic/open-and-wait', 'generic/probe', 'generic/read-page', 'generic/session-check', 'youtube/session-check', 'youtube/upload']);
    expect(errors).toEqual([]);
  } finally { await page.close(); await ctx.shutdown(); await fake.stop(); rmSync(dir, { recursive: true, force: true }); }
});
