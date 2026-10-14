import { describe, expect, it } from 'vitest';
import { captureHostSnapshot, parseScreens, parseVideoControllers } from '../src/index.js';

const GPU_FIXTURE = JSON.stringify([
  { Name: 'NVIDIA GeForce RTX 5060 Ti', AdapterRAM: 4293918720 },
  { Name: 'Microsoft Basic Display Adapter', AdapterRAM: 0 },
]);
const SCREEN_FIXTURE = JSON.stringify([
  { Primary: true, Bounds: { Width: 2560, Height: 1440 } },
  { Primary: false, Bounds: { Width: 1920, Height: 1080 } },
]);

describe('host-info (SPIKE-P6)', () => {
  it('parse GPU và màn hình từ fixture PowerShell; JSON hỏng → rỗng', () => {
    expect(parseVideoControllers(GPU_FIXTURE)).toEqual([{ name: 'NVIDIA GeForce RTX 5060 Ti', vramMb: 4095 }, { name: 'Microsoft Basic Display Adapter' }]);
    expect(parseVideoControllers('{"Name":"Solo","AdapterRAM":1048576}')).toEqual([{ name: 'Solo', vramMb: 1 }]);
    expect(parseScreens(SCREEN_FIXTURE)).toEqual([
      { width: 2560, height: 1440, primary: true },
      { width: 1920, height: 1080, primary: false },
    ]);
    expect(parseVideoControllers('garbage')).toEqual([]);
    expect(parseScreens('')).toEqual([]);
  });

  it('captureHostSnapshot với exec giả; exec lỗi → mảng rỗng; không phải Windows → không gọi exec', async () => {
    const calls: string[] = [];
    const snap = await captureHostSnapshot({
      platform: 'win32',
      exec: async (_f, args) => {
        calls.push(args.at(-1) ?? '');
        return (args.at(-1) ?? '').includes('VideoController') ? GPU_FIXTURE : SCREEN_FIXTURE;
      },
      now: () => '2026-10-14T00:00:00.000Z',
    });
    expect(snap).toMatchObject({ os: 'windows', capturedAt: '2026-10-14T00:00:00.000Z' });
    expect(snap.gpus).toHaveLength(2);
    expect(snap.displays).toHaveLength(2);
    expect(snap.ramMb).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);

    const bad = await captureHostSnapshot({ platform: 'win32', exec: async () => '' });
    expect(bad.gpus).toEqual([]);
    expect(bad.displays).toEqual([]);

    let called = false;
    const linux = await captureHostSnapshot({
      platform: 'linux',
      exec: async () => {
        called = true;
        return '';
      },
    });
    expect(linux.os).toBe('linux');
    expect(called).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')('đọc máy thật trên Windows trong < 3 s (TODO(SPIKE-P6))', async () => {
    const t0 = Date.now();
    const snap = await captureHostSnapshot({ timeoutMs: 3000 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(snap.os).toBe('windows');
    console.log('host snapshot:', JSON.stringify(snap));
  });
});
