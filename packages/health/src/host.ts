import type { Clock, HostSnapshot } from '@sctech/profilevault-contract';
import type { HostSnapshotsRepo } from '@sctech/profilevault-db';

export type HostCapture = () => Promise<HostSnapshot>;

/** Chụp và lưu `host_snapshots` (SPEC-02 §6.2, §7). `capture` tiêm được (host-info / giả lập). */
export class HostService {
  constructor(
    private readonly repo: HostSnapshotsRepo,
    private readonly capture: HostCapture,
    private readonly clock: Clock,
  ) {}

  async captureAndStore(): Promise<HostSnapshot> {
    const snap = await this.capture();
    const stored: HostSnapshot = { ...snap, capturedAt: this.clock.nowIso() };
    this.repo.insert(stored);
    return stored;
  }

  latest(): HostSnapshot | undefined {
    return this.repo.latest();
  }
}
