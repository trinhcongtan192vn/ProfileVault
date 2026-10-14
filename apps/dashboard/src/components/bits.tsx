import { useState, type ReactNode } from 'react';
import { LEVEL_LABELS, PAUSE_REASON_LABELS, RULE_STATUS_LABELS, label } from '../lib/labels';

export function LevelBadge({ level }: { level: number }) {
  return <span className={`badge level-${level}`}>{label(LEVEL_LABELS, level)}</span>;
}

export function PauseChip({ reason }: { reason: string }) {
  return <span className="chip chip-red" title={reason}>⏸ {label(PAUSE_REASON_LABELS, reason)}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const cls = status === 'pass' ? 'chip-green' : status === 'fail' ? 'chip-red' : status === 'unknown' ? 'chip-yellow' : 'chip-gray';
  return <span className={`chip ${cls}`}>{label(RULE_STATUS_LABELS, status)}</span>;
}

export function Progress({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const pct = Math.round(value * 100);
  return (
    <span className="progress" title={`${pct}%`}>
      <span className="progress-bar" style={{ width: `${pct}%` }} />
      <span className="progress-text">{pct}%</span>
    </span>
  );
}

export function Tabs({ tabs, initial }: { tabs: { id: string; label: string; render: () => ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? '');
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="tabs">
      <div className="tab-list" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? 'tab active' : 'tab'} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel">
        {current?.render()}
      </div>
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
        <div className="card-actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}
