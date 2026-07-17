'use client';

import { CSSProperties } from 'react';
import { Band, BandKey, PENDING_BAND, PerformanceLevelOption, bandBadgeStyle, bandColor } from '../../lib/performance-band';

/** Status strip: counts *people*, bucketed by their own latestScore's
 *  matched Performance Level — one card per admin-configured level (highest
 *  first), plus Unranked and Pending, always shown even at zero members, so
 *  the strip always reflects exactly what's configured on the Configuration
 *  page. Each card's headline number is the *average* latestScore of the
 *  people in that band, not how many of them there are — the member count
 *  moves to subtext instead. Pending has no score to average, so it keeps
 *  showing its member count. */
export function DashboardStatusCards({
  show,
  bands,
  levels,
  memberStatusFilter,
  setMemberStatusFilter,
  bandScoreAvg,
  stats,
  filteredTeamMemberCount,
}: {
  show: boolean;
  bands: Band[];
  levels: PerformanceLevelOption[];
  memberStatusFilter: BandKey | 'all';
  setMemberStatusFilter: (filter: BandKey | 'all') => void;
  bandScoreAvg: Record<BandKey, number | null>;
  stats: Record<BandKey, number>;
  filteredTeamMemberCount: number;
}) {
  if (!show) return null;
  return (
    <div className="p-kpi-strip">
      {bands.map((b) => {
        const isPending = b.key === PENDING_BAND;
        const count = stats[b.key] ?? 0;
        const avg = bandScoreAvg[b.key] ?? null;
        // Feeds the same --kc custom property .p-kpi-icon/.p-kpi-card.active
        // already key off of (see globals.css), plus the same 12%-tint
        // background formula the old fixed .p-status-* classes used — a
        // dynamic per-band color instead of a fixed class, same visual
        // treatment either way.
        const cardStyle = { '--kc': bandColor(b.key, levels), background: bandBadgeStyle(b.key, levels).background } as CSSProperties;
        return (
          <button
            key={b.key}
            className={`p-kpi-card${memberStatusFilter === b.key ? ' active' : ''}`}
            style={cardStyle}
            onClick={() => setMemberStatusFilter(memberStatusFilter === b.key ? 'all' : b.key)}
          >
            <div className="p-kpi-icon">●</div>
            <div className="p-kpi-label">{b.label}</div>
            <div className="p-kpi-val">{isPending || avg === null ? count : avg.toFixed(1)}</div>
            <div className="p-kpi-sub">
              {isPending
                ? 'No entries yet'
                : `${count} member${count === 1 ? '' : 's'} · ${
                    filteredTeamMemberCount ? Math.round((count / filteredTeamMemberCount) * 100) : 0
                  }% of team`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
