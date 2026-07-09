'use client';

import type { StatusKey } from '../lib/kpi-status';
import { STATUS_LABEL } from '../lib/kpi-status';

export interface DrawerKpi {
  id: string;
  code: string;
  name: string;
  unit: string;
  cadence: string;
  target: number | null;
  latestValue: number | null;
  attainment: number | null;
  status: StatusKey;
  periods: Array<{ label: string; value: number }>;
}

const fmt = (n: number | null, unit: string) => (n === null ? '—' : `${n.toLocaleString()} ${unit}`);

/** Slide-in detail panel for a single KPI — mirrors the reference's member drawer. */
export function KpiDetailDrawer({ kpi, onClose }: { kpi: DrawerKpi | null; onClose: () => void }) {
  const open = kpi !== null;
  return (
    <>
      <div className={`p-drawer-overlay${open ? ' open' : ''}`} onClick={onClose} aria-hidden={!open} />
      <div className={`p-drawer${open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="KPI detail">
        {kpi && (
          <>
            <div className="p-drawer-header">
              <button className="p-drawer-close" onClick={onClose} aria-label="close">
                ✕
              </button>
              <div className="p-drawer-avatar">{kpi.code.slice(0, 2)}</div>
              <div className="p-drawer-name">{kpi.name}</div>
              <div className="p-drawer-meta">
                {kpi.code} · {kpi.cadence}
              </div>
              <div style={{ marginTop: 8 }}>
                <span className={`p-pill p-status-${kpi.status}`}>{STATUS_LABEL[kpi.status]}</span>
              </div>
            </div>
            <div className="p-drawer-body">
              <div className="p-d-kpi-row">
                <div className="p-d-kpi">
                  <div className="p-d-kv">{fmt(kpi.latestValue, kpi.unit)}</div>
                  <div className="p-d-kl">latest</div>
                </div>
                <div className="p-d-kpi">
                  <div className="p-d-kv">{fmt(kpi.target, kpi.unit)}</div>
                  <div className="p-d-kl">target</div>
                </div>
                <div className="p-d-kpi">
                  <div className="p-d-kv">
                    {kpi.attainment === null ? '—' : `${Math.round(kpi.attainment * 100)}%`}
                  </div>
                  <div className="p-d-kl">attainment</div>
                </div>
              </div>

              <div className="p-d-section-title">recent periods</div>
              {kpi.periods.length === 0 ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  no entries recorded yet
                </p>
              ) : (
                <div>
                  {kpi.periods.map((p) => {
                    const max = Math.max(...kpi.periods.map((x) => x.value), 1);
                    return (
                      <div key={p.label} className="d-bar-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{ width: 90, fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}>{p.label}</div>
                        <div style={{ flex: 1, height: 6, background: 'color-mix(in srgb, var(--text) 8%, transparent)', borderRadius: 3, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 3,
                              width: `${(p.value / max) * 100}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                        <div style={{ width: 60, fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right', flexShrink: 0 }}>
                          {p.value.toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
