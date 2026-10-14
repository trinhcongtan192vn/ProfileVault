import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes, makeQueryClient } from '../src/App';
import { UiProvider } from '../src/components/ui';
import { OverviewTable } from '../src/pages/Overview';
import { furyInstallMessage } from '../src/components/FuryInstallBanner';
import type { OverviewRow } from '@sctech/profilevault-contract';

function render(path: string, child = <AppRoutes />) {
  const client = makeQueryClient();
  const html = renderToString(<QueryClientProvider client={client}><UiProvider><MemoryRouter initialEntries={[path]}>{child}</MemoryRouter></UiProvider></QueryClientProvider>);
  client.clear(); return html;
}
describe('SSR dashboard', () => {
  it.each(['/', '/bindings/new', '/bindings/ab_a', '/inbox', '/jobs', '/runs/rn_a', '/system', '/schedules', '/settings'])('render %s không lỗi', (path) => { expect(render(path)).toBeTruthy(); });
  it('bảng tổng quan hiện kênh và nút lên mức bị khóa khi chưa đạt', () => {
    const row: OverviewRow = { binding: { id: 'ab_a', platform: 'youtube', accountId: 'UC1', displayName: 'Kênh A', furyProfileId: 'p1', marketCountry: 'DE', level: 0, levelSince: '2026-10-14T00:00:00Z', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null, allowedRoots: [], packConfig: {} }, daysAtLevel: 0, readiness: { nextLevel: 1, progress: 0, canPromote: false, missing: ['days_at_level'] }, openPauses: [], lastRed: null, consistency: null, exit: null, fury: { version: null, detectSuitePassed: false } };
    const html = render('/', <OverviewTable rows={[row]} />);
    expect(html).toContain('Kênh A'); expect(html).toContain('disabled=""'); expect(html).toContain('+ Sự kiện');
  });
  it('banner tự cài Fury: tiến độ tải, lỗi; sẵn sàng → không hiện', () => {
    const base = { state: 'ready' as const, step: null, pinnedVersion: '0.3.22', appVersion: '0.3.22', coreVersion: '155.0.8059.39', progress: null, error: null, updatedAt: '2026-10-14T00:00:00Z' };
    expect(furyInstallMessage(base)).toBeNull();
    expect(furyInstallMessage({ ...base, state: 'downloading', step: 'core', progress: { received: 50 * 1048576, total: 141 * 1048576 } })).toBe('Đang tải trình duyệt Fury 0.3.22: 50/141 MB');
    expect(furyInstallMessage({ ...base, state: 'installing', step: 'app' })).toBe('Đang cài ứng dụng Fury 0.3.22…');
    expect(furyInstallMessage({ ...base, state: 'failed', error: 'HTTP 404' })).toContain('HTTP 404');
  });
});
