'use client';

import type { StatusKey } from '../lib/kpi-status';
import { STATUS_LABEL, statusBadgeStyle } from '../lib/kpi-status';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export interface DrawerKpi {
  id: string;
  name: string;
  status: StatusKey;
  areas: Array<{
    id: string;
    name: string;
    cadence: string;
    latestValue: number | null;
    previousValue: number | null;
    entries: Array<{
      label: string;
      value: number;
      personName: string;
      evaluatorName: string;
      reviewType: string | null;
      anonymous: boolean;
      context: string | null;
      comment: string | null;
    }>;
  }>;
}

const REVIEW_TYPE_LABEL: Record<string, string> = {
  self: 'self',
  peer: 'peer',
  manager: 'manager',
  '360': '360',
};

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

function Delta({ latest, previous }: { latest: number | null; previous: number | null }) {
  if (latest === null || previous === null) return null;
  const diff = Math.round((latest - previous) * 100) / 100;
  if (diff === 0) {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        no change vs. previous period
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span style={{ fontSize: 11, color: up ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
      {up ? '▲' : '▼'} {Math.abs(diff).toLocaleString()} vs. previous period
    </span>
  );
}

/** Slide-in detail panel for a single KPI — one section per Evaluation Area. */
export function KpiDetailDrawer({ kpi, onClose }: { kpi: DrawerKpi | null; onClose: () => void }) {
  return (
    <Sheet open={kpi !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-[480px]">
        {kpi && (
          <>
            <SheetHeader className="p-drawer-header">
              <div className="p-drawer-avatar">{kpi.name.slice(0, 2).toUpperCase()}</div>
              <SheetTitle className="p-drawer-name">{kpi.name}</SheetTitle>
              <div className="p-drawer-meta">
                {kpi.areas.length} evaluation area{kpi.areas.length === 1 ? '' : 's'}
              </div>
              <div style={{ marginTop: 8 }}>
                <Badge className="border-transparent" style={statusBadgeStyle(kpi.status)}>
                  {STATUS_LABEL[kpi.status]}
                </Badge>
              </div>
            </SheetHeader>
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
                        <div className="p-d-kv" style={{ fontSize: 14 }}>
                          {area.cadence}
                        </div>
                        <div className="p-d-kl">cadence</div>
                      </div>
                    </div>
                    <div style={{ margin: '-10px 0 10px' }}>
                      <Delta latest={area.latestValue} previous={area.previousValue} />
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
                            <div key={`${entry.label}-${i}`} style={{ marginBottom: 10 }}>
                              <div className="d-bar-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                                <div
                                  style={{
                                    width: 30,
                                    fontSize: 11,
                                    fontFamily: 'var(--mono)',
                                    textAlign: 'right',
                                    flexShrink: 0,
                                  }}
                                >
                                  {entry.value.toLocaleString()}
                                </div>
                              </div>
                              <div className="muted" style={{ fontSize: 10.5, marginLeft: 98, marginTop: 2 }}>
                                {entry.reviewType &&
                                  `${REVIEW_TYPE_LABEL[entry.reviewType] ?? entry.reviewType} review`}{' '}
                                by {entry.evaluatorName}
                                {entry.anonymous && ' (anonymous)'}
                              </div>
                              {entry.context && (
                                <div style={{ fontSize: 11, marginLeft: 98, marginTop: 2, color: 'var(--text-2)' }}>
                                  context: {entry.context}
                                </div>
                              )}
                              {entry.comment && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    marginLeft: 98,
                                    marginTop: 2,
                                    color: 'var(--text-2)',
                                    fontStyle: 'italic',
                                  }}
                                >
                                  “{entry.comment}”
                                </div>
                              )}
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
      </SheetContent>
    </Sheet>
  );
}
