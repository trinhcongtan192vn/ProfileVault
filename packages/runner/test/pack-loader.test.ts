import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackLoader } from '../src/pack-loader.js';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
describe('Nạp pack', () => {
  it('pack chính thức lint sạch và công bố flow M0 + M1', async () => {
    const loader = new PackLoader(() => '0.2.23');
    await loader.load(path.resolve('packs/generic')); await loader.load(path.resolve('packs/youtube'));
    expect(loader.listFlows().map((f) => [f.id, f.status])).toEqual([['generic/session-check', 'enabled'], ['generic/probe', 'enabled'], ['generic/read-page', 'enabled'], ['generic/open-and-wait', 'enabled'], ['youtube/session-check', 'enabled'], ['youtube/upload', 'enabled']]);
    expect(() => loader.validateBinding('youtube', { studioLanguage: 'vi' })).toThrow();
  });
  it('raw interaction vô hiệu pack trước import và appApi không tương thích', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pv-pack-')); dirs.push(dir); mkdirSync(path.join(dir, 'src'));
    const manifest = { id: 'unsafe', version: '1.0.0', platform: '*', appApi: '^1.0.0', furyVersions: '*', bindingConfigSchema: './config.json', forbiddenActions: [], flows: ['check'] };
    writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest)); writeFileSync(path.join(dir, 'config.json'), '{"type":"object"}'); writeFileSync(path.join(dir, 'src', 'bad.ts'), 'locator.click()');
    const loader = new PackLoader(() => '0.2.23'); const result = await loader.load(dir);
    expect(result.status).toBe('disabled'); expect(result.reason).toContain('pv/no-raw-interaction');
    writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ ...manifest, appApi: '^99.0.0' }));
    expect((await loader.load(dir)).reason).toContain('API');
  });
});
