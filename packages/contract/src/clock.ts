/** Đồng hồ tiêm được (SPEC-09 §3.2). */
export interface Clock {
  now(): Date;
  nowIso(): string;
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};

/** Đồng hồ giả cho test: đặt hoặc tiến thời gian tùy ý. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = '2026-01-01T00:00:00.000Z') {
    this.current = typeof start === 'number' ? start : new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  nowMs(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }

  set(date: Date | string | number): void {
    this.current = typeof date === 'number' ? date : new Date(date).getTime();
  }
}
