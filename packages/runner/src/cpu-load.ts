import os from 'node:os';
/** Trung bình CPU trong cửa sổ một phút từ delta bộ đếm OS. */
export class CpuLoad {
  private previous = this.snapshot();
  private readonly samples: { at: number; idle: number; total: number }[] = [];
  private snapshot() {
    return os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((n, v) => n + v, 0) }), { idle: 0, total: 0 });
  }
  busy(now: number): boolean {
    const next = this.snapshot(); this.samples.push({ at: now, idle: next.idle - this.previous.idle, total: next.total - this.previous.total }); this.previous = next;
    while (this.samples[0] && this.samples[0].at < now - 60_000) this.samples.shift();
    const sum = this.samples.reduce((s, v) => ({ idle: s.idle + v.idle, total: s.total + v.total }), { idle: 0, total: 0 });
    return sum.total > 0 && 1 - sum.idle / sum.total > 0.6;
  }
}
