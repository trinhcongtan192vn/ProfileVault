import { InstanceAlreadyRunningError } from '@sctech/profilevault-core';
import { bootstrap } from './bootstrap.js';

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
    const stop = (signal: string) => {
      ctx.logger.info('nhận tín hiệu dừng', { signal });
      ctx
        .shutdown()
        .then(() => resolve(0))
        .catch(() => resolve(1));
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
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
