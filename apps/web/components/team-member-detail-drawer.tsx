'use client';

import type { TeamMemberBreakdown } from '@pulse/contracts';
import { LoadingState } from './loading-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
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

/**
 * Slide-in detail panel for a single team member, opened from the dashboard's
 * team overview table — their own blended rate per Evaluation Area, across
 * every KPI that covers them. Deliberately not broken out by rater/reporter
 * (see KpiDetailDrawer for that level of detail on the self-view side) —
 * this is the person's own rate, full stop.
 */
export function TeamMemberDetailDrawer({
  breakdown,
  loading,
  error,
  onClose,
}: {
  breakdown: TeamMemberBreakdown | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  const open = loading || breakdown !== null || Boolean(error);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full sm:max-w-[480px]">
        {error ? (
          <Alert variant="destructive" style={{ marginTop: 24 }}>
            <AlertDescription>couldn&apos;t load this team member&apos;s rate — {error}</AlertDescription>
          </Alert>
        ) : loading && !breakdown ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <LoadingState label="loading rate…" />
          </div>
        ) : (
          breakdown && (
            <>
              <SheetHeader className="p-drawer-header">
                <div className="p-drawer-avatar">{breakdown.displayName.slice(0, 2).toUpperCase()}</div>
                <SheetTitle className="p-drawer-name">{breakdown.displayName}</SheetTitle>
                <div className="p-drawer-meta">
                  {breakdown.kpis.length} KPI{breakdown.kpis.length === 1 ? '' : 's'}
                </div>
              </SheetHeader>
              <div className="p-drawer-body">
                {breakdown.kpis.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no KPI covers this person yet
                  </p>
                ) : (
                  breakdown.kpis.map((kpi) => (
                    <div key={kpi.id} style={{ marginBottom: 22 }}>
                      <div className="p-d-kl" style={{ marginBottom: 8, fontSize: 13, fontWeight: 500 }}>
                        {kpi.name}
                      </div>
                      {kpi.areas.length === 0 ? (
                        <p className="muted" style={{ fontSize: 12 }}>
                          no evaluation areas defined yet
                        </p>
                      ) : (
                        kpi.areas.map((area) => (
                          <div key={area.id} style={{ marginBottom: 14 }}>
                            <div className="p-d-kpi-row">
                              <div className="p-d-kpi">
                                <div className="p-d-kv">{fmt(area.latestValue)}</div>
                                <div className="p-d-kl">{area.name}</div>
                              </div>
                              <div className="p-d-kpi">
                                <div className="p-d-kv" style={{ fontSize: 14 }}>
                                  {CADENCE_LABEL[area.cadence] ?? area.cadence}
                                </div>
                                <div className="p-d-kl">cadence</div>
                              </div>
                            </div>
                            <div style={{ margin: '-6px 0 0' }}>
                              <Delta latest={area.latestValue} previous={area.previousValue} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )
        )}
      </SheetContent>
    </Sheet>
  );
}
