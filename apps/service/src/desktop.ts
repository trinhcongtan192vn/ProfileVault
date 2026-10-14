import { BUS_EVENTS, type BusEventName } from '@sctech/profilevault-contract';
import { realTimers, type Timers } from '@sctech/profilevault-fury-client';
import type { RunnerFacade } from '@sctech/profilevault-gateway';
import { windowsAutostart } from './autostart.js';
import type { ServiceContext } from './bootstrap.js';
import { Notifier, windowsNotify } from './notifier.js';
import { openBrowser } from './open-browser.js';
import { createTrayBackend, TrayController, type TrayBackend } from './tray.js';

export async function startDesktop(ctx: ServiceContext, runner: RunnerFacade, exit: () => Promise<void>, options: { backend?: TrayBackend; timers?: Timers } = {}): Promise<() => Promise<void>> {
  const timers = options.timers ?? realTimers;
  const warn = (err: unknown) => ctx.logger.warn('Tray/thông báo lỗi', { error: String(err) });
  const notifier = new Notifier({ clock: ctx.clock, config: ctx.config, bus: ctx.bus, health: ctx.health, notify: windowsNotify((p) => ctx.gateway.createOpenUrl(p), openBrowser) });
  let tray: TrayController | undefined;
  if (process.platform === 'win32' || options.backend) {
    try {
      tray = new TrayController({
        backend: options.backend ?? await createTrayBackend(warn), clock: ctx.clock, autostart: windowsAutostart(),
        state: () => {
          const s = runner.systemInfo();
          const bindings = ctx.health.listBindings();
          return { reachable: ctx.poller.lastHealth?.reachable ?? false, running: s.queue.running, waiting: s.queue.needsUser + bindings.reduce((n, b) => n + ctx.health.listPauses(b.id, { open: true }).filter((p) => ['red_event', 'proxy_changed', 'manual'].includes(p.reason)).length, 0) + ctx.health.listChecklistExpiring(7).length,
            recentDemotion: bindings.some((b) => ctx.health.listLevelChanges(b.id).some((c) => c.kind === 'demote' && ctx.clock.nowMs() - Date.parse(c.createdAt) < 86_400_000)), busyMode: s.busyMode, globalPause: s.globalPause };
        },
        openDashboard: () => openBrowser(ctx.gateway.createOpenUrl()), setBusy: (b) => runner.setBusyMode(b), setPaused: (p) => runner.setGlobalPause(p), exit, onError: warn,
      });
      await tray.refresh();
    } catch (err) { warn(err); }
  } else ctx.logger.warn('Tray chỉ có trên Windows');
  const refresh = () => { void tray?.refresh().catch(warn); };
  const unsub = (Object.keys(BUS_EVENTS) as BusEventName[]).map((name) => ctx.bus.on(name, refresh));
  const stopTrayTimer = timers.setInterval(refresh, 15_000);
  const tick = () => { void notifier.tick().catch(warn); };
  const stopNotifierTimer = timers.setInterval(tick, 60_000);
  tick();
  return async () => { stopTrayTimer(); stopNotifierTimer(); unsub.forEach((fn) => fn()); notifier.stop(); await tray?.stop(); };
}
