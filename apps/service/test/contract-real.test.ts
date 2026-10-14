import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { FakeClock, type AutomationLevel } from '@sctech/profilevault-contract';
import { defineContractSuite, type ContractTarget } from '@sctech/profilevault-contract/testing';
import { MemorySecretStore } from '@sctech/profilevault-core';
import { FakeTimers, HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury } from '@sctech/profilevault-fury-client/testing';
import { bootstrap, type ServiceContext } from '../src/bootstrap.js';

/** Bộ contract test của @sctech/profilevault-contract chạy với ProfileVault thật (SPEC-09 §5). */
const dirs: string[] = [];
let fake: FakeFury;
let ctx: ServiceContext;
let target: ContractTarget;

beforeAll(async () => {
  fake = new FakeFury({ version: '0.3.22' });
  await fake.start();
  const appData = mkdtempSync(path.join(os.tmpdir(), 'pv-contract-'));
  const local = mkdtempSync(path.join(os.tmpdir(), 'pv-contract-'));
  dirs.push(appData, local);
  mkdirSync(appData, { recursive: true });
  writeFileSync(path.join(appData, 'config.json'), JSON.stringify({ gateway: { host: '127.0.0.1', port: 0 } }));
  const timers = new FakeTimers();
  const clock = new FakeClock('2026-10-15T03:00:00.000Z');
  ctx = await bootstrap({ env: { PV_APPDATA_DIR: appData, PV_LOCALAPPDATA_DIR: local }, secretStore: new MemorySecretStore(), clock, timers, fury: new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0 }), pidAlive: () => true, startBackground: false, listen: true });
  const base = ctx.gatewayUrl!;
  const open = await fetch(ctx.gateway.createOpenUrl(), { redirect: 'manual' });
  const cookie = open.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = ((await (await fetch(`${base}/internal/session`, { headers: { cookie } })).json()) as { csrfToken: string }).csrfToken;
  const token = async (body: Record<string, unknown>) => ((await (await fetch(`${base}/internal/clients`, { method: 'POST', headers: { cookie, 'x-pv-csrf': csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { token: string }).token;
  const bind = async (n: number, level: AutomationLevel) => {
    fake.upsertProfile({ id: `p${n}`, name: `K${n}`, personaId: `win-${n}`, os: 'windows' });
    const b = await ctx.health.createBinding({ platform: 'youtube', accountId: `UCcontract${n}xxxxxxxxxxx`, displayName: `K${n}`, furyProfileId: `p${n}`, marketCountry: 'VN' });
    ctx.healthBundle.repos.bindings.setLevel(b.id, level, ctx.clock.nowIso());
    for (const p of ctx.healthBundle.repos.pauses.listOpen(b.id)) ctx.healthBundle.repos.pauses.clear(p.id, ctx.clock.nowIso(), 'system');
    return { platform: 'youtube', accountId: b.accountId };
  };
  target = {
    baseUrl: base,
    fullToken: await token({ name: 'full', scopes: ['accounts.read', 'jobs.read', 'jobs.write'] }),
    readOnlyToken: await token({ name: 'ro', scopes: ['jobs.read'] }),
    uploadOnlyToken: await token({ name: 'upload-only', scopes: ['jobs.read', 'jobs.write'], flowFilter: ['youtube/upload'] }),
    account: await bind(1, 1),
    lowAccount: await bind(2, 0),
  };
});
afterAll(async () => {
  await ctx.shutdown();
  await fake.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

defineContractSuite('ProfileVault thật', () => target);
