/** Định dạng hiển thị: thời gian theo múi giờ cấu hình (SPEC-00 §2, mặc định Asia/Bangkok). */

let currentTz = 'Asia/Bangkok';
export function setTimezone(tz: string): void {
  currentTz = tz;
}
export function timezone(): string {
  return currentTz;
}

export function formatDateTime(iso: string | null | undefined, tz: string = currentTz): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

export function formatDate(iso: string | null | undefined, tz: string = currentTz): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** "3 phút trước", "2 ngày trước". */
export function relative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const diff = now - Date.parse(iso);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'trước' : 'nữa';
  if (abs < 60_000) return diff >= 0 ? 'vừa xong' : 'sắp tới';
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} phút ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} giờ ${suffix}`;
  return `${Math.round(abs / 86_400_000)} ngày ${suffix}`;
}

export function percent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 100)}%`;
}

export function json(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Giá trị datetime-local theo timezone cấu hình ↔ UTC. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: currentTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (name: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === name)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function fromLocalInput(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(v);
  if (!m) return '';
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), Number((m[7] ?? '0').padEnd(3, '0')));
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: currentTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const get = (name: Intl.DateTimeFormatPartTypes) => Number(p.find((part) => part.type === name)?.value ?? 0);
    const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    guess = wall - (shown - Math.floor(guess / 1000) * 1000);
  }
  return new Date(guess).toISOString();
}
