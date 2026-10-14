export type TrayColor = 'gray' | 'green' | 'orange' | 'red';
const COLORS: Record<TrayColor, number[]> = { gray: [128, 128, 128], green: [22, 163, 74], orange: [245, 158, 11], red: [220, 38, 38] };
/** ICO 16×16, bitmap BGRA + AND mask, sinh tại runtime. */
export function trayIcon(color: TrayColor): string {
  const pixels = 16 * 16 * 4;
  const dib = Buffer.alloc(40 + pixels + 64);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(16, 4); dib.writeInt32LE(32, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels, 20);
  const [r = 0, g = 0, b = 0] = COLORS[color];
  for (let i = 0; i < 256; i++) { const p = 40 + i * 4; dib[p] = b; dib[p + 1] = g; dib[p + 2] = r; dib[p + 3] = 255; }
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = 16; header[7] = 16;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(dib.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, dib]).toString('base64');
}
