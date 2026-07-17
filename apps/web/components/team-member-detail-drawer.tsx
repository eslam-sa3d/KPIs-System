'use client';

import type { TeamMemberBreakdown } from '@pulse/contracts';
import { LoadingState } from './loading-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PerformanceLevelOption, bandBadgeStyle, bandOf } from '../lib/performance-band';

const REVIEW_TYPE_LABEL: Record<string, string> = {
  self: 'Self',
  peer: 'Peer',
  manager: 'Manager',
  '360': '360',
};

/**
 * Slide-in detail panel for a single team member, opened from the dashboard's
 * team overview table — a chronological feed of their own scored submissions,
 * across every KPI that covers them. Each row is a real, traceable
 * FormSubmission answer, never blended with any other.
 */
export function TeamMemberDetailDrawer({
  breakdown,
  levels,
  loading,
  error,
  onClose,
}: {
  breakdown: TeamMemberBreakdown | null;
  levels: PerformanceLevelOption[];
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
            <AlertDescription>Couldn&apos;t load this team member&apos;s submissions — {error}</AlertDescription>
          </Alert>
        ) : loading && !breakdown ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <LoadingState label="Loading submissions…" />
          </div>
        ) : (
          breakdown && (
            <>
              <SheetHeader className="p-drawer-header">
                <div className="p-drawer-avatar">{breakdown.displayName.slice(0, 2).toUpperCase()}</div>
                <SheetTitle className="p-drawer-name">{breakdown.displayName}</SheetTitle>
                <div className="p-drawer-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {breakdown.latestScore !== null && (
                    <Badge className="border-transparent" style={bandBadgeStyle(bandOf(breakdown), levels)}>
                      {breakdown.latestScore.toFixed(1)} ·{' '}
                      {breakdown.performanceLevel ? breakdown.performanceLevel.label : 'Unranked'}
                    </Badge>
                  )}
                  <span>
                    {breakdown.submissions.length} scored submission{breakdown.submissions.length === 1 ? '' : 's'}
                  </span>
                </div>
              </SheetHeader>
              <div className="p-drawer-body">
                {breakdown.submissions.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    No KPI has scored this person yet
                  </p>
                ) : (
                  breakdown.submissions.map((s, i) => (
                    <div key={`${s.submittedAt}-${i}`} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--mono)' }}>{s.display}</span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {s.kpiName} · {s.areaName}
                        </span>
                      </div>
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                        {REVIEW_TYPE_LABEL[s.reviewType] ?? s.reviewType} review by {s.evaluatorName}
                        {s.anonymous && ' (anonymous)'} ·{' '}
                        {new Date(s.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                      {s.context && (
                        <div style={{ fontSize: 11, marginTop: 2, color: 'var(--text-2)' }}>Context: {s.context}</div>
                      )}
                      {s.comment && (
                        <div style={{ fontSize: 11, marginTop: 2, color: 'var(--text-2)', fontStyle: 'italic' }}>
                          “{s.comment}”
                        </div>
                      )}
                    </div>
                  ))
                )}
                {breakdown.rawActivity && breakdown.rawActivity.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <h4 className="muted" style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>
                      Other form activity ({breakdown.rawActivity.length})
                    </h4>
                    <p className="muted" style={{ fontSize: 10.5, marginBottom: 12 }}>
                      Responses naming this person on forms with no KPI mapping yet — a scoreable answer here can
                      still be their most recent score above.
                    </p>
                    {breakdown.rawActivity.map((a, i) => (
                      <div key={`${a.submissionId}-${i}`} style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{a.formTitle}</span>
                          <span className="muted" style={{ fontSize: 10.5 }}>
                            {new Date(a.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            {a.submittedByName && ` · by ${a.submittedByName}`}
                          </span>
                        </div>
                        <ul className="summary-samples" style={{ marginTop: 4 }}>
                          {a.answers.map((ans) => (
                            <li key={ans.fieldKey}>
                              {ans.fieldLabel}: {ans.display}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        )}
      </SheetContent>
    </Sheet>
  );
}
