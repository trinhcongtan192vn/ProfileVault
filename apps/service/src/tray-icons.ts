import { TRAY_LOGO_MASK, TRAY_LOGO_SIZE } from './tray-logo.js';

export type TrayColor = 'gray' | 'green' | 'orange' | 'red';
const COLORS: Record<TrayColor, number[]> = { gray: [128, 128, 128], green: [22, 163, 74], orange: [245, 158, 11], red: [220, 38, 38] };
const MASK = Buffer.from(TRAY_LOGO_MASK, 'base64');

/** ICO 32×32 (BGRA + AND mask): logo ProfileVault, phần đen tô màu trạng thái, phần trắng giữ trắng. */
export function trayIcon(color: TrayColor): string {
  const n = TRAY_LOGO_SIZE;
  const pixels = n * n * 4;
  const andRow = Math.ceil(n / 32) * 4;
  const dib = Buffer.alloc(40 + pixels + andRow * n);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(n, 4); dib.writeInt32LE(n * 2, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels, 20);
  const [r = 0, g = 0, b = 0] = COLORS[color];
  const mix = (c: number, ink: number) => Math.round(255 + ((c - 255) * ink) / 255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const src = (y * n + x) * 2;
      const alpha = MASK[src] ?? 0;
      const ink = MASK[src + 1] ?? 0;
      const p = 40 + ((n - 1 - y) * n + x) * 4; // DIB lưu hàng từ dưới lên
      dib[p] = mix(b, ink); dib[p + 1] = mix(g, ink); dib[p + 2] = mix(r, ink); dib[p + 3] = alpha;
    }
  }
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = n; header[7] = n;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(dib.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, dib]).toString('base64');
}
