import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock, type FuryInstallStatus, type FuryReleasePin } from '@sctech/profilevault-contract';
import { FuryInstaller, parseAgentVersion, parseCoreVersion, type ExecResult } from '../src/index.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-fi-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SETUP = Buffer.from('fake-setup-exe');
const CORE = Buffer.alloc(9 * 1024 * 1024, 7);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PIN: FuryReleasePin = {
  version: '0.3.22',
  setup: { url: 'https://example.test/v0.3.22/fury-0.3.22-windows-x64-setup.exe', sha256: sha(SETUP), size: SETUP.length },
  core: { url: 'https://example.test/v0.3.22/fury-core-0.3.22-windows-x64.tar.xz', sha256: sha(CORE), size: CORE.length },
};

/** Fury giả: bộ cài tạo fury-agent.exe; install-core ghi nhận core. Đầu ra theo mẫu đã xác minh trên 0.3.22. */
function fakeMachine(localAppData: string, opts: { setupCreatesAgent?: boolean; coreInstalled?: boolean; apiPortSet?: boolean } = {}) {
  const calls: string[][] = [];
  let core = opts.coreInstalled ?? false;
  const agent = path.join(localAppData, 'Fury', 'fury-agent.exe');
  const exec = async (file: string, args: string[]): Promise<ExecResult> => {
    calls.push([path.basename(file), ...args.map((a) => (/^([A-Za-z]:)?[\\/].+[\\/]/.test(a) ? path.basename(a) : a))]);
    if (file === 'reg') return opts.apiPortSet ? { code: 0, stdout: '    FURY_API_PORT    REG_SZ    35000', stderr: '' } : { code: 1, stdout: '', stderr: 'not found' };
    if (file === 'setx') return { code: 0, stdout: 'SUCCESS', stderr: '' };
    if (file.endsWith('setup.exe')) {
      if (opts.setupCreatesAgent !== false) {
        mkdirSync(path.dirname(agent), { recursive: true });
        writeFileSync(agent, 'x');
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    const log = '2026-10-14T15:39:12Z  INFO fury_agent: logging here as well as to stderr\n';
    if (args[0] === '--help') return { code: 0, stdout: 'fury-agent 0.3.22\n\nUSAGE:\n  fury-agent serve\n', stderr: log };
    if (args[0] === 'install-core' && args.length === 1) {
      return core ? { code: 0, stdout: '155.0.8059.39\n  C:\\x\\core.bundle\\Fury/chrome.exe\n', stderr: log } : { code: 1, stdout: '', stderr: `${log}no core installed\n` };
    }
    if (args[0] === 'install-core') {
      core = true;
      return { code: 0, stdout: 'installed 155.0.8059.39\n  C:\\x\\core.bundle\\Fury/chrome.exe\n', stderr: log };
    }
    return { code: 2, stdout: '', stderr: 'unknown' };
  };
  return { exec, calls, agent };
}

function fakeFetch(files: Record<string, Buffer>, hits: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    hits.push(url);
    const body = files[url];
    if (!body) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(body), { status: 200 });
  }) as typeof fetch;
}

function make(localAppData: string, downloadsDir: string, exec: (f: string, a: string[], t: number) => Promise<ExecResult>, fetchFn: typeof fetch, statuses: FuryInstallStatus[] = []) {
  return new FuryInstaller({ localAppData, downloadsDir, clock: new FakeClock('2026-10-14T00:00:00.000Z'), pin: PIN, platform: 'win32', exec, fetch: fetchFn, onStatus: (s) => statuses.push(s) });
}

describe('parse đầu ra fury-agent (mẫu 0.3.22)', () => {
  it('đọc phiên bản agent và core; đầu ra lạ → null', () => {
    expect(parseAgentVersion('INFO log\nfury-agent 0.3.22\n\nUSAGE:')).toBe('0.3.22');
    expect(parseCoreVersion('installed 155.0.8059.39\n  C:\\a\\chrome.exe')).toBe('155.0.8059.39');
    expect(parseCoreVersion('155.0.8059.39\n  C:\\a\\chrome.exe')).toBe('155.0.8059.39');
    expect(parseCoreVersion('no core installed')).toBeNull();
    expect(parseAgentVersion('')).toBeNull();
  });
});

describe('FuryInstaller (SPEC-00 §11.1)', () => {
  it('máy trống: tải bộ cài + core, kiểm SHA-256, chạy /S và install-core, xóa file tải, trạng thái ready', async () => {
    const la = tmp();
    const dl = tmp();
    const m = fakeMachine(la);
    const statuses: FuryInstallStatus[] = [];
    const inst = make(la, dl, m.exec, fakeFetch({ [PIN.setup.url]: SETUP, [PIN.core.url]: CORE }), statuses);
    const s = await inst.ensure();
    expect(s).toMatchObject({ state: 'ready', appVersion: '0.3.22', coreVersion: '155.0.8059.39', error: null, pinnedVersion: '0.3.22' });
    expect(m.calls).toEqual([
      ['fury-0.3.22-windows-x64-setup.exe', '/S'],
      ['fury-agent.exe', '--help'],
      ['fury-agent.exe', 'install-core'],
      ['fury-agent.exe', 'install-core', 'fury-core-0.3.22-windows-x64.tar.xz'],
      // bật automation API của Fury cho user (chưa có → setx)
      ['reg', 'query', 'HKCU\\Environment', '/v', 'FURY_API_PORT'],
      ['setx', 'FURY_API_PORT', '35000'],
    ]);
    expect(readdirSync(dl)).toEqual([]);
    const states = statuses.map((x) => `${x.state}:${x.step ?? ''}`);
    expect(states).toContain('downloading:app');
    expect(states).toContain('installing:app');
    expect(states).toContain('downloading:core');
    expect(states).toContain('installing:core');
    expect(statuses.some((x) => x.state === 'downloading' && x.step === 'core' && (x.progress?.received ?? 0) > 0)).toBe(true);
  });

  it('Fury đã cài đủ: không tải, không chạy bộ cài', async () => {
    const la = tmp();
    const m = fakeMachine(la, { coreInstalled: true, apiPortSet: true });
    mkdirSync(path.dirname(m.agent), { recursive: true });
    writeFileSync(m.agent, 'x');
    const hits: string[] = [];
    const s = await make(la, tmp(), m.exec, fakeFetch({}, hits)).ensure();
    expect(s.state).toBe('ready');
    expect(hits).toEqual([]);
    // FURY_API_PORT đã có → không ghi đè (không gọi setx)
    expect(m.calls.map((c) => c[0] === 'fury-agent.exe' ? c[1] : c[0])).toEqual(['--help', 'install-core', 'reg']);
  });

  it('có app nhưng thiếu core: chỉ tải và cài core', async () => {
    const la = tmp();
    const m = fakeMachine(la);
    mkdirSync(path.dirname(m.agent), { recursive: true });
    writeFileSync(m.agent, 'x');
    const hits: string[] = [];
    const s = await make(la, tmp(), m.exec, fakeFetch({ [PIN.core.url]: CORE }, hits)).ensure();
    expect(s).toMatchObject({ state: 'ready', coreVersion: '155.0.8059.39' });
    expect(hits).toEqual([PIN.core.url]);
  });

  it('SHA-256 không khớp: không chạy bộ cài, xóa file, trạng thái failed; lần sau thử lại được', async () => {
    const la = tmp();
    const dl = tmp();
    const m = fakeMachine(la);
    const bad = make(la, dl, m.exec, fakeFetch({ [PIN.setup.url]: Buffer.from('tampered-setup') }));
    const s = await bad.ensure();
    expect(s.state).toBe('failed');
    expect(s.error).toMatch(/không khớp/);
    expect(m.calls).toEqual([]);
    expect(readdirSync(dl)).toEqual([]);
    expect(existsSync(m.agent)).toBe(false);

    const good = make(la, dl, m.exec, fakeFetch({ [PIN.setup.url]: SETUP, [PIN.core.url]: CORE }));
    expect((await good.ensure()).state).toBe('ready');
  });

  it('HTTP lỗi hoặc bộ cài không tạo fury-agent.exe → failed có lý do', async () => {
    const la = tmp();
    const s1 = await make(la, tmp(), fakeMachine(la).exec, fakeFetch({})).ensure();
    expect(s1).toMatchObject({ state: 'failed' });
    expect(s1.error).toMatch(/HTTP 404/);

    const la2 = tmp();
    const s2 = await make(la2, tmp(), fakeMachine(la2, { setupCreatesAgent: false }).exec, fakeFetch({ [PIN.setup.url]: SETUP })).ensure();
    expect(s2.state).toBe('failed');
    expect(s2.error).toMatch(/fury-agent\.exe/);
  });

  it('file tải sẵn đã khớp được dùng lại; gọi ensure hai lần đồng thời chỉ chạy một lần', async () => {
    const la = tmp();
    const dl = tmp();
    writeFileSync(path.join(dl, 'fury-0.3.22-windows-x64-setup.exe'), SETUP);
    const m = fakeMachine(la, { coreInstalled: true });
    const hits: string[] = [];
    const inst = make(la, dl, m.exec, fakeFetch({}, hits));
    const [a, b] = await Promise.all([inst.ensure(), inst.ensure()]);
    expect(a).toBe(b);
    expect(a.state).toBe('ready');
    expect(hits).toEqual([]);
    expect(m.calls.filter((c) => c[1] === '/S')).toHaveLength(1);
  });

  it('không phải Windows → unsupported, không gọi gì', async () => {
    const hits: string[] = [];
    const inst = new FuryInstaller({ localAppData: tmp(), downloadsDir: tmp(), clock: new FakeClock('2026-10-14T00:00:00.000Z'), pin: PIN, platform: 'linux', fetch: fakeFetch({}, hits), exec: async () => ({ code: 0, stdout: '', stderr: '' }) });
    expect((await inst.ensure()).state).toBe('unsupported');
    expect(hits).toEqual([]);
    inst.disable();
    expect(inst.status().state).toBe('disabled');
  });
});
