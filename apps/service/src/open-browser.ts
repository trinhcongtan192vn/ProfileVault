import { spawn } from 'node:child_process';

/** Dùng đối số riêng, không đưa URL qua shell. */
export function openBrowser(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Chỉ mở dashboard loopback');
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', parsed.href], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}
