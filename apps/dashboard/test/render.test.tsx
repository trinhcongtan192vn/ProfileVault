import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes, makeQueryClient } from '../src/App';
import { UiProvider } from '../src/components/ui';
import { OverviewTable } from '../src/pages/Overview';
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
});
