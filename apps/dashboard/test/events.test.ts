import { describe, expect, it } from 'vitest';
import { findEvent, ONE_TAP_EVENTS, shortcutFor, validateOccurredAt } from '../src/lib/events';

describe('Khai báo một chạm', () => {
  it('chỉ upload/note được hoàn tác, sự kiện đỏ cần xác nhận', () => {
    expect(ONE_TAP_EVENTS.filter((e) => e.undoable).map((e) => e.type)).toEqual(['manual.upload', 'manual.note']);
    expect(findEvent('manual.captcha')!.red).toBe(true);
  });
  it('U không ghi khi đang nhập hay có modifier', () => {
    expect(shortcutFor('U', 'DIV', false)).toBe('manual.upload');
    expect(shortcutFor('u', 'INPUT', false)).toBeNull();
    expect(shortcutFor('u', 'TEXTAREA', false)).toBeNull();
    expect(shortcutFor('u', 'DIV', true)).toBeNull();
  });
  it('kiểm thời điểm khai báo', () => {
    const now = Date.parse('2026-10-14T00:00:00Z');
    expect(validateOccurredAt('2026-10-14T00:00:00Z', now)).toBeNull();
    expect(validateOccurredAt('2026-10-01T00:00:00Z', now)).toContain('7 ngày');
    expect(validateOccurredAt('invalid', now)).toContain('không hợp lệ');
  });
});
