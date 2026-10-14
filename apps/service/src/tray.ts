import { createRequire } from 'node:module';
import type { Action, ClickEvent, Conf, MenuItem } from 'systray2';
import type { Clock } from '@sctech/profilevault-contract';
import type { Autostart } from './autostart.js';
import { trayIcon, type TrayColor } from './tray-icons.js';

export interface TrayItem { title: string; enabled?: boolean; checked?: boolean }
export interface TrayBackend {
  setMenu(items: TrayItem[], color: TrayColor): Promise<void>;
  onClick(listener: (index: number) => void): void;
  kill(): Promise<void>;
}
export interface TrayState { reachable: boolean; running: number; waiting: number; recentDemotion: boolean; busyMode: boolean; globalPause: boolean }
export function trayColor(s: TrayState): TrayColor { return !s.reachable ? 'gray' : s.recentDemotion ? 'red' : s.waiting > 0 ? 'orange' : 'green'; }
export class TrayController {
  private confirmUntil = 0;
  constructor(private readonly d: {
    backend: TrayBackend; clock: Clock; state(): TrayState; autostart: Autostart;
    openDashboard(): void; setBusy(busy: boolean): void; setPaused(paused: boolean): void;
    exit(): Promise<void>; onError(err: unknown): void;
  }) { d.backend.onClick((index) => { void this.click(index).catch((err: unknown) => d.onError(err)); }); }
  async refresh(): Promise<void> {
    const s = this.d.state();
    await this.d.backend.setMenu([
      { title: 'Mở dashboard' },
      { title: `Fury ${s.reachable ? 'online' : 'offline'} · Đang chạy ${s.running} · Chờ bạn ${s.waiting}`, enabled: false },
      { title: 'Chế độ bận', checked: s.busyMode },
      { title: 'Tạm dừng mọi job', checked: s.globalPause },
      { title: 'Khởi động cùng Windows', checked: this.d.autostart.enabled() },
      { title: this.confirmUntil > this.d.clock.nowMs() ? `Thoát? Có ${s.running} run đang chạy — bấm lại để xác nhận` : 'Thoát' },
    ], trayColor(s));
  }
  async click(index: number): Promise<void> {
    const s = this.d.state();
    if (index === 0) this.d.openDashboard();
    if (index === 2) this.d.setBusy(!s.busyMode);
    if (index === 3) this.d.setPaused(!s.globalPause);
    if (index === 4) this.d.autostart.set(!this.d.autostart.enabled());
    if (index === 5) {
      if (s.running > 0 && this.confirmUntil <= this.d.clock.nowMs()) this.confirmUntil = this.d.clock.nowMs() + 10_000;
      else { await this.d.exit(); return; }
    }
    await this.refresh();
  }
  stop(): Promise<void> { return this.d.backend.kill(); }
}

// systray2 là CommonJS với default export lồng; hỗ trợ cả hai dạng module.
export interface NativeTray {
  onError(listener: (err: Error) => void): void;
  ready(): Promise<void>;
  sendAction(action: Action): Promise<unknown>;
  onClick(listener: (event: ClickEvent) => void): Promise<unknown>;
  kill(exitNode: boolean): Promise<void>;
}
const SysTray = (createRequire(import.meta.url)('systray2') as { default: new (conf: Conf) => NativeTray }).default;
export async function createTrayBackend(onError: (err: unknown) => void, factory: (config: Conf) => NativeTray = (config) => new SysTray(config)): Promise<TrayBackend> {
  // systray2 gán ID lúc khởi tạo; giữ cùng các object khi cập nhật menu.
  const nativeItems: MenuItem[] = Array.from({ length: 6 }, () => ({ title: 'Đang tải…', tooltip: 'ProfileVault', enabled: false }));
  const tray = factory({ menu: { icon: trayIcon('gray'), title: 'ProfileVault', tooltip: 'ProfileVault', items: nativeItems }, copyDir: false });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([tray.ready(), new Promise<never>((_, reject) => {
      tray.onError((err) => { onError(err); reject(err); });
      timeout = setTimeout(() => reject(new Error('Tray không khởi động trong 5 giây')), 5000);
    })]);
  } catch (err) { void tray.kill(false).catch(onError); throw err; }
  finally { if (timeout) clearTimeout(timeout); }
  return {
    async setMenu(items, color) { items.forEach((item, i) => Object.assign(nativeItems[i]!, { ...item, tooltip: item.title, enabled: item.enabled ?? true })); await tray.sendAction({ type: 'update-menu', menu: { icon: trayIcon(color), title: 'ProfileVault', tooltip: 'ProfileVault', items: nativeItems } }); },
    onClick(listener) { void tray.onClick((event) => listener(event.seq_id)).catch(onError); },
    kill: () => tray.kill(false),
  };
}
