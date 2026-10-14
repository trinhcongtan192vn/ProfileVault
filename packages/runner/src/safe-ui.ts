import { PvError } from '@sctech/profilevault-contract';
import { realTimers, type Timers } from '@sctech/profilevault-fury-client';
import type { Locator, Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { ForbiddenPatternsSchema } from '@sctech/profilevault-contract';
const globalPatterns = ForbiddenPatternsSchema.parse(JSON.parse(readFileSync(new URL('../data/forbidden-global.json', import.meta.url), 'utf8')));

export interface Expectation { visible?: Locator; urlMatches?: RegExp; valueEquals?: string }
export class SafeUi {
  private readonly patterns: RegExp[];
  constructor(private readonly d: { page: Page; sites: string[]; forbidden?: string[]; timers?: Timers; random?: () => number; actionDelayMs?: [number, number]; typingDelayMs?: [number, number]; verifiedFiles?: string[]; denied?: (detail: Record<string, unknown>) => void }) {
    this.patterns = [...globalPatterns, ...(d.forbidden ?? [])].map((p) => new RegExp(p, 'iu'));
  }
  assertUrl(url: string): void {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || !this.d.sites.includes(u.hostname) || u.username || u.password || /\/(?:signin\/v2\/challenge\/pwd|security|password|recovery)(?:[/?]|$)/i.test(u.pathname)) this.deny('domain_or_security');
  }
  private deny(reason: string): never { this.d.denied?.({ reason }); throw new PvError('FORBIDDEN_ACTION', 'Thao tác ngoài phạm vi an toàn', { reason }); }
  private async delay(range: [number, number] = this.d.actionDelayMs ?? [300, 1200]): Promise<void> {
    await (this.d.timers ?? realTimers).sleep(range[0] + Math.floor((this.d.random ?? Math.random)() * Math.max(0, range[1] - range[0])));
  }
  private async allowed(target: Locator): Promise<void> {
    this.assertUrl(this.d.page.url());
    this.assertUrl(await target.evaluate((el) => el.ownerDocument.URL));
    // evaluate hàm cố định, chỉ đọc thuộc tính; accessible name qua ARIA snapshot (Playwright).
    const labels = await target.evaluate((el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.tagName === 'SELECT' ? null : el.textContent, el.getAttribute('value')].filter(Boolean).join('\n'));
    const aria = await target.ariaSnapshot();
    const accessible = /"([^"]+)"/.exec(aria.split('\n')[0] ?? '')?.[1] ?? '';
    if ([...labels.split('\n'), ...accessible.split('\n')].some((text) => this.patterns.some((p) => p.test(text.trim())))) this.deny('forbidden_label');
  }
  private checkCurrent(): void { this.assertUrl(this.d.page.url()); }
  async goto(url: string): Promise<void> { this.assertUrl(url); await this.delay(); await this.d.page.goto(url, { waitUntil: 'domcontentloaded' }); this.checkCurrent(); }
  async click(target: Locator, expect?: Expectation): Promise<void> {
    await this.allowed(target); await this.delay(); await target.click(); this.checkCurrent();
    if (expect?.visible) await expect.visible.waitFor({ state: 'visible' });
    if (expect?.urlMatches) await this.d.page.waitForURL(expect.urlMatches);
    if (expect?.valueEquals !== undefined && await target.inputValue() !== expect.valueEquals) throw new PvError('SITE_CHANGED', 'Giá trị hậu kiểm không khớp');
  }
  async fill(target: Locator, value: string, opts?: { typing?: boolean }): Promise<void> {
    this.checkCurrent(); await this.delay();
    await target.fill(opts?.typing ? '' : value);
    if (opts?.typing) for (const character of value) { await this.delay(this.d.typingDelayMs ?? [40, 140]); await target.pressSequentially(character); }
  }
  async check(target: Locator): Promise<void> { await this.allowed(target); await this.delay(); await target.check(); this.checkCurrent(); }
  async select(target: Locator, value: string): Promise<void> {
    await this.allowed(target);
    const label = await target.locator('option').evaluateAll((options, selected) => options.filter((el) => el.getAttribute('value') === selected).map((el) => el.textContent ?? '').join('\n'), value);
    if (this.patterns.some((p) => p.test(label.trim()) || p.test(value.trim()))) this.deny('forbidden_selection');
    await this.delay(); await target.selectOption(value); this.checkCurrent();
  }
  async press(key: string): Promise<void> {
    this.checkCurrent();
    const focused = this.d.page.locator(':focus');
    if (/(?:Enter|Space| )/i.test(key)) {
      await this.allowed(focused);
      if (await focused.evaluate((el) => el.tagName === 'SELECT')) {
        const selected = await focused.evaluate((el) => Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.textContent ?? '').join('\n'));
        if (selected.split('\n').some((text) => this.patterns.some((p) => p.test(text.trim())))) this.deny('forbidden_selection');
      }
    }
    await this.delay(); await this.d.page.keyboard.press(key); this.checkCurrent();
  }
  async upload(target: Locator, filePath: string): Promise<void> {
    this.checkCurrent(); if (!this.d.verifiedFiles?.includes(filePath)) throw new PvError('FILE_NOT_ALLOWED', 'File chưa được Job service xác minh');
    await this.delay(); await target.setInputFiles(filePath);
  }
  async read(target: Locator): Promise<string> { this.checkCurrent(); return await target.textContent() ?? ''; }
  async waitFor(target: Locator, opts?: { state?: 'visible' | 'hidden'; timeoutSeconds?: number }): Promise<void> { this.checkCurrent(); await target.waitFor({ state: opts?.state ?? 'visible', timeout: (opts?.timeoutSeconds ?? 120) * 1000 }); }
  async exists(target: Locator, timeoutSeconds = 1): Promise<boolean> { this.checkCurrent(); try { await target.waitFor({ state: 'visible', timeout: timeoutSeconds * 1000 }); return true; } catch { return false; } }
}
