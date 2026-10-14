import { describe, expect, it } from 'vitest';
import { formatDateTime, fromLocalInput, percent, relative, setTimezone, toLocalInput } from '../src/lib/format';

describe('Định dạng dashboard', () => {
  it('hiển thị theo timezone và xử lý dữ liệu trống', () => {
    expect(formatDateTime('2026-10-14T03:00:00Z', 'Asia/Bangkok')).toContain('10:00');
    expect(formatDateTime('bad')).toBe('—'); expect(percent(null)).toBe('—'); expect(percent(0.735)).toBe('74%');
  });
  it('thời gian tương đối', () => {
    expect(relative('2026-10-14T00:00:00Z', Date.parse('2026-10-14T00:02:00Z'))).toBe('2 phút trước');
  });
  it('datetime-local theo timezone cấu hình và input trống không gây crash', () => {
    setTimezone('Asia/Bangkok'); expect(toLocalInput('2026-10-14T03:00:00Z')).toBe('2026-10-14T10:00');
    expect(fromLocalInput('2026-10-14T10:00')).toBe('2026-10-14T03:00:00.000Z'); expect(fromLocalInput('')).toBe('');
  });
});
