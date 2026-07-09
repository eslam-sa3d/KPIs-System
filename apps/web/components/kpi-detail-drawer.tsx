'use client';

import type { StatusKey } from '../lib/kpi-status';
import { STATUS_LABEL } from '../lib/kpi-status';

export interface DrawerKpi {
  id: string;
  name: string;
  status: StatusKey;
  areas: Array<{
    id: string;
    name: string;
    cadence: string;
    latestValue: number | null;
    entries: Array<{ label: string; value: number; personName: string }>;
  }>;
}

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

/** Slide-in detail panel for a single KPI — one section per Evaluation Area. */
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
              <div className="p-drawer-avatar">{kpi.name.slice(0, 2).toUpperCase()}</div>
              <div className="p-drawer-name">{kpi.name}</div>
              <div className="p-drawer-meta">
                {kpi.areas.length} evaluation area{kpi.areas.length === 1 ? '' : 's'}
              </div>
              <div style={{ marginTop: 8 }}>
                <span className={`p-pill p-status-${kpi.status}`}>{STATUS_LABEL[kpi.status]}</span>
              </div>
            </div>
            <div className="p-drawer-body">
              {kpi.areas.length === 0 ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  no evaluation areas defined yet
                </p>
              ) : (
                kpi.areas.map((area) => (
                  <div key={area.id} style={{ marginBottom: 22 }}>
                    <div className="p-d-kpi-row">
                      <div className="p-d-kpi">
                        <div className="p-d-kv">{fmt(area.latestValue)}</div>
                        <div className="p-d-kl">{area.name}</div>
                      </div>
                      <div className="p-d-kpi">
                        <div className="p-d-kv" style={{ fontSize: 14 }}>{area.cadence}</div>
                        <div className="p-d-kl">cadence</div>
                      </div>
                    </div>

                    {area.entries.length === 0 ? (
                      <p className="muted" style={{ fontSize: 12 }}>
                        no scores recorded yet
                      </p>
                    ) : (
                      <div>
                        {area.entries.map((entry, i) => {
                          const max = Math.max(...area.entries.map((x) => x.value), 1);
                          return (
                            <div
                              key={`${entry.label}-${i}`}
                              className="d-bar-row"
                              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}
                            >
                              <div style={{ width: 90, fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}>
                                {entry.label} <span className="muted">· {entry.personName}</span>
                              </div>
                              <div
                                style={{
                                  flex: 1,
                                  height: 6,
                                  background: 'color-mix(in srgb, var(--text) 8%, transparent)',
                                  borderRadius: 3,
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    height: '100%',
                                    borderRadius: 3,
                                    width: `${(entry.value / max) * 100}%`,
                                    background: 'var(--accent)',
                                  }}
                                />
                              </div>
                              <div style={{ width: 30, fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right', flexShrink: 0 }}>
                                {entry.value.toLocaleString()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
