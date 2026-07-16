'use client';

import { STATUS_ICON, STATUS_LABEL, STATUS_ORDER, StatusKey } from '../../lib/kpi-status';

/** Status strip: counts *people*, bucketed by their own blended score.
 *  Each card's headline number is the *average* score of the people in that
 *  band, not how many of them there are — the member count moves to
 *  subtext instead. Pending has no score to average (statusOf(null) is the
 *  only way into that band), so it keeps showing its member count. */
export function DashboardStatusCards({
  show,
  memberStatusFilter,
  setMemberStatusFilter,
  bandScoreAvg,
  stats,
  filteredTeamMemberCount,
}: {
  show: boolean;
  memberStatusFilter: StatusKey | 'all';
  setMemberStatusFilter: (filter: StatusKey | 'all') => void;
  bandScoreAvg: Record<StatusKey, number | null>;
  stats: Record<StatusKey, number>;
  filteredTeamMemberCount: number;
}) {
  if (!show) return null;
  return (
    <div className="p-kpi-strip">
      {STATUS_ORDER.map((s) => (
        <button
          key={s}
          className={`p-kpi-card p-status-${s}${memberStatusFilter === s ? ' active' : ''}`}
          onClick={() => setMemberStatusFilter(memberStatusFilter === s ? 'all' : s)}
        >
          <div className="p-kpi-icon">{STATUS_ICON[s]}</div>
          <div className="p-kpi-label">{STATUS_LABEL[s]}</div>
          <div className="p-kpi-val">
            {s === 'pending' || bandScoreAvg[s] === null ? stats[s] : bandScoreAvg[s]!.toFixed(1)}
          </div>
          <div className="p-kpi-sub">
            {s === 'pending'
              ? 'No entries yet'
              : `${stats[s]} member${stats[s] === 1 ? '' : 's'} · ${
                  filteredTeamMemberCount ? Math.round((stats[s] / filteredTeamMemberCount) * 100) : 0
                }% of team`}
          </div>
        </button>
      ))}
    </div>
  );
}
