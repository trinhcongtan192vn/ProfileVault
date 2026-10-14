import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { FakeTimers } from '../../packages/fury-client/dist/index.js';
import { sessionCheck as youtube } from '../../packs/youtube/dist/index.js';
import { sessionCheck as generic } from '../../packs/generic/dist/index.js';
import { SafeUi, type FlowContext } from '../../packages/runner/dist/index.js';
import type { Binding } from '../../packages/contract/dist/index.js';

const binding: Binding = { id: 'ab_01K7E4R0000000000000000001', platform: 'youtube', accountId: 'UCEXPECTED', displayName: 'Fixture', furyProfileId: 'p1', marketCountry: 'DE', packConfig: { studioLanguage: 'en', _generic: { sites: ['studio.youtube.com', 'accounts.google.com'], session: { url: 'https://studio.youtube.com/', loggedOutUrlPattern: '^https://accounts\\.google\\.com/', challengeUrlPattern: '/challenge/' } } }, allowedRoots: [], level: 1, levelSince: '2026-10-14T00:00:00Z', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null };
for (const scenario of [
  { name: 'đúng kênh', url: 'https://studio.youtube.com/channel/UCEXPECTED', fixture: 'studio', state: 'logged_in' },
  { name: 'sai kênh', url: 'https://studio.youtube.com/channel/UCOTHER', fixture: 'studio', state: 'wrong_account' },
  { name: 'đăng xuất', url: 'https://accounts.google.com/signin', fixture: 'logged-out', state: 'logged_out' },
  { name: 'challenge', url: 'https://accounts.google.com/challenge/test', fixture: 'challenge', state: 'challenge' },
  { name: 'chưa xác định', url: 'https://studio.youtube.com/unknown', fixture: 'studio', state: 'unknown' },
]) {
  test(`session-check ${scenario.name}`, async ({ page }) => {
    const html = readFileSync(path.resolve(`packs/youtube/flows/session-check/test/fixtures/${scenario.fixture}.html`), 'utf8');
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    // Giả lập đích chuyển hướng trực tiếp, không để trình duyệt theo redirect ra mạng.
    const ui = new class extends SafeUi {
      override async goto(url: string): Promise<void> { expect(url).toBe('https://studio.youtube.com/'); await super.goto(scenario.url); }
    }({ page, sites: ['studio.youtube.com', 'accounts.google.com'], timers: new FakeTimers() });
    const ctx: FlowContext<Record<string, never>> = { input: {}, mode: null, binding, page, state: {}, ui, step: async (_name, fn) => fn(), humanGate: async () => { throw new Error('Session-check không dùng gate'); }, fail: (code) => { throw new Error(code); }, log() {}, artifact: async () => '' };
    expect((await youtube.run(ctx)).state).toBe(scenario.state);
    const genericResult = await generic.run(ctx);
    expect(genericResult.state).toBe(scenario.state === 'wrong_account' || scenario.state === 'unknown' ? 'logged_in' : scenario.state);
  });
}
test('SafeUi chặn accessible name Publish, option Public và domain ngoài; cho Private', async ({ page }) => {
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: readFileSync(path.resolve('packs/youtube/flows/session-check/test/fixtures/studio.html'), 'utf8') }));
  const ui = new SafeUi({ page, sites: ['studio.youtube.com'], timers: new FakeTimers() });
  await ui.goto('https://studio.youtube.com/channel/UCEXPECTED');
  await expect(ui.click(page.getByRole('button', { name: 'Publish' }))).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION' });
  await expect(ui.select(page.getByRole('combobox'), 'public')).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION' });
  await ui.select(page.getByRole('combobox'), 'private');
  await expect(ui.goto('https://example.com')).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION' });
  await expect(ui.upload(page.locator('input'), 'anything.mp4')).rejects.toMatchObject({ code: 'FILE_NOT_ALLOWED' });
});
