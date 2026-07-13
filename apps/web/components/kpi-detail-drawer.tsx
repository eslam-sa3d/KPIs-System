'use client';

import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export interface DrawerKpi {
  id: string;
  name: string;
  /** Tally of this KPI's own recent submissions by reviewType — a rigor/
   *  credibility signal distinct from the org-wide mix (a KPI that's all
   *  self-assessment reads very differently from one with real peer coverage). */
  reviewMix: Record<string, number>;
  /** % of this KPI's own recent submissions recorded anonymously, or null
   *  when there are no submissions yet to compute a rate from. */
  anonymousRate: number | null;
  areas: Array<{
    id: string;
    name: string;
    cadence: string;
    /** Most recent first — each one a real, traceable FormSubmission answer,
     *  never blended with any other. */
    submissions: Array<{
      display: string;
      personName: string;
      evaluatorName: string;
      reviewType: string;
      anonymous: boolean;
      context: string | null;
      comment: string | null;
      submittedAt: string;
    }>;
  }>;
}

const REVIEW_TYPE_LABEL: Record<string, string> = {
  self: 'self',
  peer: 'peer',
  manager: 'manager',
  '360': '360',
};

/** Slide-in detail panel for a single KPI — one section per Evaluation Area,
 *  each a chronological feed of its own recent raw submissions. */
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
              {Object.keys(kpi.reviewMix).length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(kpi.reviewMix).map(([type, count]) => (
                    <Badge key={type} variant="outline" className="py-1">
                      {REVIEW_TYPE_LABEL[type] ?? type}: {count}
                    </Badge>
                  ))}
                  {kpi.anonymousRate !== null && (
                    <Badge variant="outline" className="py-1">
                      {kpi.anonymousRate}% anonymous
                    </Badge>
                  )}
                </div>
              )}
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
                        <div className="p-d-kv">{area.submissions[0]?.display ?? '—'}</div>
                        <div className="p-d-kl">{area.name}</div>
                      </div>
                      <div className="p-d-kpi">
                        <div className="p-d-kv" style={{ fontSize: 14 }}>
                          {area.cadence}
                        </div>
                        <div className="p-d-kl">cadence</div>
                      </div>
                    </div>

                    {area.submissions.length === 0 ? (
                      <p className="muted" style={{ fontSize: 12 }}>
                        no submissions scored yet
                      </p>
                    ) : (
                      <div>
                        {area.submissions.map((s, i) => (
                          <div key={`${s.submittedAt}-${i}`} style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--mono)' }}>
                                {s.display}
                              </span>
                              <span className="muted" style={{ fontSize: 11 }}>
                                {s.personName} ·{' '}
                                {new Date(s.submittedAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                            <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                              {REVIEW_TYPE_LABEL[s.reviewType] ?? s.reviewType} review by {s.evaluatorName}
                              {s.anonymous && ' (anonymous)'}
                            </div>
                            {s.context && (
                              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--text-2)' }}>
                                context: {s.context}
                              </div>
                            )}
                            {s.comment && (
                              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--text-2)', fontStyle: 'italic' }}>
                                “{s.comment}”
                              </div>
                            )}
                          </div>
                        ))}
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
