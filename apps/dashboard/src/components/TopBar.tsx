import type { SystemInfo } from '@sctech/profilevault-contract';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { get } from '../lib/api';
import { qk, type SseStatus } from '../lib/sse';

const NAV = [
  { to: '/', label: 'Tổng quan', end: true },
  { to: '/inbox', label: 'Chờ bạn' },
  { to: '/jobs', label: 'Job & run' },
  { to: '/system', label: 'Hệ thống' },
  { to: '/schedules', label: 'Lịch' },
  { to: '/settings', label: 'Cài đặt' },
];

/** Thanh trên luôn hiện (SPEC-07 §3): Fury, Chờ bạn, job đang chạy, chế độ bận, tạm dừng toàn cục. */
export function TopBar({ sse }: { sse: SseStatus }) {
  const sys = useQuery({ queryKey: qk.system, queryFn: () => get<SystemInfo>('/internal/system'), refetchInterval: 30_000 });
  const inbox = useQuery({ queryKey: qk.inbox, queryFn: () => get<{ items: unknown[] }>('/internal/inbox'), refetchInterval: 60_000 });
  const fury = sys.data?.fury;
  const furyText = !fury ? 'Fury: ?' : !fury.reachable ? 'Fury offline' : `Fury ${fury.version ?? ''}${fury.supported ? '' : ' ⚠ ngoài khoảng hỗ trợ'}`;
  const furyCls = !fury || !fury.reachable ? 'chip-gray' : fury.supported ? 'chip-green' : 'chip-red';
  const waiting = inbox.data?.items.length ?? 0;
  return (
    <header className="topbar">
      <div className="brand">ProfileVault</div>
      <nav>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'nav active' : 'nav')}>
            {n.label}
            {n.to === '/inbox' && waiting > 0 && <span className="count">{waiting}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="status">
        <span className={`chip ${furyCls}`}>{furyText}</span>
        <span className="chip">Đang chạy {sys.data?.queue.running ?? 0}</span>
        {sys.data?.busyMode && <span className="chip chip-yellow">Chế độ bận</span>}
        {sys.data?.globalPause && <span className="chip chip-red">Tạm dừng mọi job</span>}
        {sse !== 'open' && <span className="chip chip-yellow">{sse === 'lost' ? 'Mất kết nối thời gian thực' : 'Đang kết nối…'}</span>}
      </div>
    </header>
  );
}
