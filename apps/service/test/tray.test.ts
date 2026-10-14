import { describe, expect, it } from 'vitest';
import { FakeClock } from '@sctech/profilevault-contract';
import { createTrayBackend, TrayController, trayColor, type TrayBackend, type TrayItem, type TrayState } from '../src/tray.js';
import { trayIcon } from '../src/tray-icons.js';
import type { Action, MenuItem } from 'systray2';

describe('Tray SPEC-07 §6', () => {
  it('backend native giữ object/ID menu sau refresh', async () => {
    const actions: Action[] = [];
    let initial: MenuItem[] = [];
    const backend = await createTrayBackend(() => undefined, (config) => {
      initial = config.menu.items;
      return { onError() {}, async ready() {}, async sendAction(action) { actions.push(action); }, async onClick() {}, async kill() {} };
    });
    await backend.setMenu(Array.from({ length: 6 }, (_, i) => ({ title: `Menu ${i}` })), 'green');
    const action = actions[0]!;
    expect(action.type).toBe('update-menu');
    if (action.type === 'update-menu') { expect(action.menu.items[0]).toBe(initial[0]); expect(action.menu.items[0]!.enabled).toBe(true); }
    await backend.kill();
  });
  it('ưu tiên offline, hạ mức, chờ bạn, bình thường; icon ICO hợp lệ', () => {
    const s: TrayState = { reachable: true, recentDemotion: false, running: 0, waiting: 0, busyMode: false, globalPause: false };
    expect(trayColor(s)).toBe('green');
    expect(trayColor({ ...s, waiting: 1 })).toBe('orange');
    expect(trayColor({ ...s, waiting: 1, recentDemotion: true })).toBe('red');
    expect(trayColor({ ...s, recentDemotion: true, reachable: false })).toBe('gray');
    expect(Buffer.from(trayIcon('green'), 'base64').readUInt16LE(2)).toBe(1);
  });
  it('menu đổi trạng thái và chỉ thoát sau xác nhận trong 10 giây', async () => {
    const clock = new FakeClock();
    const s: TrayState = { reachable: true, recentDemotion: false, running: 1, waiting: 2, busyMode: false, globalPause: false };
    let menu: TrayItem[] = []; let opened = 0; let exited = 0; let autostart = false; let killed = false;
    const backend: TrayBackend = { async setMenu(items) { menu = items; }, onClick() {}, async kill() { killed = true; } };
    const tray = new TrayController({ backend, clock, state: () => s, autostart: { enabled: () => autostart, set: (value) => { autostart = value; } }, openDashboard: () => { opened++; }, setBusy: (value) => { s.busyMode = value; }, setPaused: (value) => { s.globalPause = value; }, async exit() { exited++; }, onError: (e) => { throw e; } });
    await tray.refresh(); expect(menu[1]).toMatchObject({ enabled: false });
    await tray.click(0); expect(opened).toBe(1);
    await tray.click(2); expect(s.busyMode).toBe(true);
    await tray.click(3); expect(s.globalPause).toBe(true);
    await tray.click(4); expect(autostart).toBe(true);
    await tray.click(5); expect(exited).toBe(0); expect(menu[5]!.title).toContain('xác nhận');
    clock.advance(11_000); await tray.click(5); expect(exited).toBe(0);
    await tray.click(5); expect(exited).toBe(1);
    await tray.stop(); expect(killed).toBe(true);
  });
});
