import { InstanceAlreadyRunningError } from '@sctech/profilevault-core';
import { bootstrap } from './bootstrap.js';
import { startDesktop } from './desktop.js';
import { existsSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openBrowser } from './open-browser.js';

export async function main(): Promise<number> {
  let ctx;
  try {
    ctx = await bootstrap({ logToStdout: process.env.PV_LOG_STDOUT !== '0' });
  } catch (err) {
    if (err instanceof InstanceAlreadyRunningError) {
      console.error(err.message);
      return 3;
    }
    console.error('Không khởi động được ProfileVault:', err instanceof Error ? err.message : err);
    return 1;
  }

  return new Promise<number>((resolve) => {
    const requestFile = path.join(ctx.paths.appData, 'open-dashboard.request');
    const readyFile = path.join(ctx.paths.localAppData, 'ready');
    const openDashboard = () => openBrowser(ctx.gateway.createOpenUrl());
    const consumeRequest = () => {
      if (!existsSync(requestFile)) return;
      try { unlinkSync(requestFile); openDashboard(); } catch (err) { ctx.logger.warn('Không mở được dashboard', { error: String(err) }); }
    };
    const requests = watch(ctx.paths.appData, { persistent: false }, (_event, filename) => { if (filename === 'open-dashboard.request') consumeRequest(); });
    consumeRequest();
    let stopDesktop: (() => Promise<void>) | undefined;
    let stopping = false;
    if (ctx.gatewayUrl) console.log(`Dashboard: ${ctx.gateway.createOpenUrl()}`);
    const stop = (signal: string) => {
      if (stopping) return;
      stopping = true;
      requests.close();
      if (existsSync(readyFile)) unlinkSync(readyFile);
      ctx.logger.info('nhận tín hiệu dừng', { signal });
      Promise.resolve().then(async () => { await stopDesktop?.(); await ctx.shutdown(); })
        .then(() => resolve(0))
        .catch(() => resolve(1));
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
    void startDesktop(ctx, ctx.runner, async () => { stop('tray'); }).then((cleanup) => { stopDesktop = cleanup; if (stopping) void cleanup(); }).catch((err: unknown) => ctx.logger.warn('Không khởi tạo được tray', { error: String(err) }));
    if (process.env.PV_OPEN_DASHBOARD === '1') openDashboard();
    writeFileSync(readyFile, String(process.pid));
    // Giữ tiến trình sống; các feature sau gắn scheduler/gateway/tray vào đây.
    const keepAlive = setInterval(() => undefined, 60_000);
    process.once('exit', () => clearInterval(keepAlive));
  });
}

const isEntry = process.argv[1] !== undefined && /main\.(ts|js)$/.test(process.argv[1]);
if (isEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
