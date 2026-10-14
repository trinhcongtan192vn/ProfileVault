import { describe, expect, it } from 'vitest';
import { invalidationsFor, qk } from '../src/lib/sse';

describe('SSE vô hiệu cache', () => {
  it('sự kiện cập nhật đúng binding và chart', () => {
    const keys = invalidationsFor('health.event_recorded', { event: { bindingId: 'ab_a' } });
    expect(keys).toContainEqual(qk.events('ab_a')); expect(keys).toContainEqual(qk.overview); expect(keys).toContainEqual(['chart', 'ab_a']);
  });
  it('run và Fury cập nhật toàn cục, sự kiện lạ bỏ qua', () => {
    expect(invalidationsFor('run.needs_user', { runId: 'rn_a' })).toContainEqual(qk.run('rn_a'));
    expect(invalidationsFor('fury.status_changed', {})).toContainEqual(qk.fury);
    expect(invalidationsFor('unknown', null)).toEqual([]);
  });
});
