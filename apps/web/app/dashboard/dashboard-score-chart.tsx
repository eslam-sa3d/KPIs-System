'use client';

import dynamic from 'next/dynamic';
import { LoadingState } from '@/components/loading-state';

// Lazy-loaded: recharts only ships once the dashboard actually renders a chart.
const CountBarChart = dynamic(() => import('../../components/count-bar-chart'), {
  ssr: false,
  loading: () => <LoadingState label="Loading chart…" />,
});

/** Each scored member's own latestScore — one bar per person, distinct from
 *  "submissions by person" which counts raw activity, not this value. */
export function DashboardScoreChart({
  show,
  scoreByPerson,
  hasScoreByPerson,
}: {
  show: boolean;
  scoreByPerson: Array<{ label: string; count: number }>;
  hasScoreByPerson: boolean;
}) {
  if (!show) return null;
  return (
    <div className="p-card" style={{ marginBottom: 16 }}>
      <div className="p-card-title">Score by team member</div>
      {hasScoreByPerson ? (
        <CountBarChart
          data={scoreByPerson}
          textColor="var(--text-3)"
          gridColor="var(--border)"
          barColor="var(--accent)"
          countLabel="Score"
        />
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>
          No scored team members yet.
        </p>
      )}
    </div>
  );
}
