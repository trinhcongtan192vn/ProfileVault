import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addBinding, makeHarness, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => { h = await makeHarness(); });
afterEach(() => h.cleanup());
describe('Hoàn tác khai báo', () => {
  it('giữ sự kiện gốc, ghi bù và loại upload khỏi ngưỡng', async () => {
    const b = await addBinding(h, 1); const health = h.bundle.health;
    const event = await health.recordManualEvent(b.id, 'manual.upload');
    expect((await health.evaluateReadiness(b.id)).conditions.find((c) => c.condition.kind === 'event_count')!.current).toBe(1);
    const undo = await health.undoManualEvent(b.id, event.id);
    expect(undo.payload.undoOf).toBe(event.id);
    expect(health.listEvents(b.id, { types: ['manual.upload'] })).toHaveLength(1);
    expect((await health.evaluateReadiness(b.id)).conditions.find((c) => c.condition.kind === 'event_count')!.current).toBe(0);
    await expect(health.undoManualEvent(b.id, undo.id)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(health.undoManualEvent(b.id, event.id)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
  it('không hoàn tác sự kiện đỏ, khác kênh hoặc quá 10 phút', async () => {
    const a = await addBinding(h, 1); const b = await addBinding(h, 2); const health = h.bundle.health;
    const red = await health.recordManualEvent(a.id, 'manual.captcha');
    await expect(health.undoManualEvent(a.id, red.id)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const upload = await health.recordManualEvent(a.id, 'manual.upload');
    await expect(health.undoManualEvent(b.id, upload.id)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    h.clock.advance(10 * 60_000 + 1);
    await expect(health.undoManualEvent(a.id, upload.id)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});
