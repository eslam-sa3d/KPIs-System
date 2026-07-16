'use client';

import type { RecentFeedback } from '@pulse/contracts';

/** Recent context/comment feedback, org-wide — the qualitative signal
 *  usually buried one entry at a time inside a person's own drawer. */
export function DashboardRecentFeedback({
  canSeeTeamOverview,
  recentFeedback,
}: {
  canSeeTeamOverview: boolean;
  recentFeedback: RecentFeedback | null;
}) {
  if (!canSeeTeamOverview || !recentFeedback || recentFeedback.entries.length === 0) return null;
  return (
    <div className="p-card" style={{ marginBottom: 16 }}>
      <div className="p-card-title">Recent feedback</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 380, overflowY: 'auto' }}>
        {recentFeedback.entries.map((entry) => (
          <div key={entry.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 3 }}>
              {entry.kpiName} · {entry.areaName} — {entry.personName}{' '}
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{entry.display}</span>
              <span className="muted"> · {new Date(entry.createdAt).toLocaleDateString()}</span>
            </div>
            {entry.comment && <div style={{ fontSize: 13, fontStyle: 'italic' }}>“{entry.comment}”</div>}
            {entry.context && <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Context: {entry.context}</div>}
            <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
              By {entry.evaluatorName}
              {entry.anonymous && ' (anonymous)'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
