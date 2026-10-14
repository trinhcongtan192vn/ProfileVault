import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { CheckpointSchema, PackManifestSchema, SessionCheckInputSchema, SessionCheckOutputSchema } from '@sctech/profilevault-contract';
import { silentLogger } from '@sctech/profilevault-core';
import { addBinding, makeHarness } from '../../health/test/helpers.js';
import { defineFlow, type FlowDefinition } from '../src/flow.js';
import { PackLoader } from '../src/pack-loader.js';
import { Runner } from '../src/runner.js';

export async function runnerHarness(flow?: FlowDefinition) {
  const h = await makeHarness(); const browsers: Browser[] = [];
  const loader = new PackLoader(() => h.bundle.health.currentFuryVersion());
  const normal = flow ?? defineFlow({ id: 'test/check', version: '1.0.0', description: 'Test', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5 }, SessionCheckInputSchema, SessionCheckOutputSchema, async (ctx) => {
    await ctx.step('read', async () => { ctx.state.count = Number(ctx.state.count ?? 0) + 1; });
    return { state: 'logged_in' };
  });
  loader.packs.set('test', { manifest: PackManifestSchema.parse({ id: 'test', version: '1.0.0', platform: '*', appApi: '^1.0.0', furyVersions: '>=0.2.21 <0.4.0', bindingConfigSchema: './config.json', forbiddenActions: [], flows: [normal.manifest.id.split('/')[1]!] }), status: 'enabled', forbidden: [], directory: h.t.dir, flows: [normal] });
  const deps = { database: h.t.database, clock: h.clock, config: h.config, settings: h.settings, audit: h.audit, bus: h.bus, health: h.bundle.health, fury: h.fury, logger: silentLogger, runsDir: path.join(h.t.dir, 'runs'), loader, timers: h.timers, freeRamMb: () => 32768, random: () => 0.5, connect: async () => { const b = await chromium.launch({ headless: true }); await b.newContext(); browsers.push(b); return b; } };
  const runner = new Runner(deps);
  async function binding(n = 1, level: 0 | 1 | 2 | 3 = 1) {
    const b = await addBinding(h, n, { level });
    h.bundle.repos.bindings.update(b.id, { packConfig: { ...b.packConfig, studioLanguage: 'en' } }, h.clock.nowIso());
    return h.bundle.health.getBinding(b.id)!;
  }
  return { ...h, loader, runner, deps, binding, cp: CheckpointSchema, async cleanup() { await runner.stop(); await Promise.allSettled(browsers.map((b) => b.close())); await h.cleanup(); } };
}
export async function waitFor(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now(); while (!check()) { if (Date.now() - start > timeout) throw new Error('Hết thời gian đợi test'); await new Promise((resolve) => setTimeout(resolve, 10)); }
}
