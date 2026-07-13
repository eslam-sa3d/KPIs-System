'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  ActivityTrend,
  MeasurementGaps,
  RecentFeedback,
  TeamMemberBreakdown,
  TeamOverview,
} from '@pulse/contracts';
import { PortalShell, can } from '../../components/portal-shell';
import { KpiDetailDrawer, DrawerKpi } from '../../components/kpi-detail-drawer';
import { TeamMemberDetailDrawer } from '../../components/team-member-detail-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadCsv } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import { useResource } from '../../lib/use-resource';
import { STATUS_ICON, STATUS_LABEL, STATUS_ORDER, StatusKey, statusBadgeStyle, statusOf } from '../../lib/kpi-status';

// Lazy-loaded: recharts only ships once the dashboard actually renders a chart.
const CountBarChart = dynamic(() => import('../../components/count-bar-chart'), {
  ssr: false,
  loading: () => <LoadingState label="loading chart…" />,
});
const ActivityTrendChart = dynamic(() => import('../../components/activity-trend-chart'), {
  ssr: false,
  loading: () => <LoadingState label="loading chart…" />,
});

/** A single (FormKpiMapping, FormSubmission) pair, exactly as KpisService's
 *  loadScoredSubmissions produces it — raw, on its own scale, never blended
 *  with any other mapping's answer. `submittedAt` arrives as an ISO string
 *  (Date serializes that way over JSON). */
interface RawSubmission {
  mappingId: string;
  evaluationAreaId: string;
  evaluationAreaName: string;
  kpiId: string;
  kpiName: string;
  personId: string;
  personName: string;
  enteredById: string;
  enteredBy: { id: string; displayName: string };
  anonymous: boolean;
  reviewType: string;
  raw: unknown;
  display: string;
  context: string | null;
  comment: string | null;
  submittedAt: string;
  submissionId: string;
}

interface RawEvaluationArea {
  id: string;
  name: string;
  cadence: string;
  isActive: boolean;
  recentSubmissions: RawSubmission[];
}

interface RawKpi {
  id: string;
  name: string;
  isActive: boolean;
  weight: number | null;
  /** Old normalized 0-5 blend, still computed server-side from
   *  EvaluationAreaEntry — purely so the status strip can bucket this KPI
   *  into Outstanding/Meets/Needs improvement/Below/Pending. Every other
   *  display on this page uses raw, per-submission values instead. */
  latestValue: number | null;
  evaluationAreas: RawEvaluationArea[];
}

type KpiSortKey = 'name' | 'latest' | 'updated';
type MemberSortKey = 'name' | 'department' | 'latest' | 'trend' | 'updated';
type CoverageFilter = 'all' | 'scored' | 'pending';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const REVIEW_TYPE_LABEL: Record<string, string> = {
  self: 'Self',
  peer: 'Peer',
  manager: 'Manager',
  '360': '360',
};

/** Every submission across a KPI's areas, most recent first — loadScoredSubmissions
 *  already sorts each area's own list, so this just merges and re-sorts across areas. */
function allSubmissions(kpi: RawKpi): RawSubmission[] {
  return kpi.evaluationAreas
    .flatMap((a) => a.recentSubmissions)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

function TrendIndicator({
  latest,
  previous,
}: {
  latest: { raw: unknown; display: string } | null;
  previous: { raw: unknown; display: string } | null;
}) {
  if (!latest || !previous) {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        —
      </span>
    );
  }
  // Only rating/nps/slider/number/boolean answers are plain numbers — a
  // select/multi_select/likert/performance_level raw value has no single
  // magnitude to diff, so those just show both values without an arrow.
  if (typeof latest.raw !== 'number' || typeof previous.raw !== 'number') {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        {previous.display} → {latest.display}
      </span>
    );
  }
  const diff = Math.round((latest.raw - previous.raw) * 100) / 100;
  if (diff === 0) {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        no change
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span
      style={{ fontSize: 11, color: up ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)', fontWeight: 600 }}
    >
      {up ? '▲' : '▼'} {Math.abs(diff).toLocaleString()}
    </span>
  );
}

export default function DashboardPage() {
  const user = useSession();
  const [level, setLevel] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');
  const [sort, setSort] = useState<{ key: KpiSortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberCoverageFilter, setMemberCoverageFilter] = useState<CoverageFilter>('all');
  const [memberStatusFilter, setMemberStatusFilter] = useState<StatusKey | 'all'>('all');
  const [memberSort, setMemberSort] = useState<{ key: MemberSortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 });
  const [memberFilter, setMemberFilter] = useState('');
  const canSeeTeamOverview = can(user, 'dashboards:view');

  const { data: kpis } = useResource<RawKpi[]>(user ? '/v1/kpis/my' : null);

  // org-wide roster with KPI coverage/latest submission/last-updated — admin-only, powers the team coverage cards and table below
  const { data: teamOverview } = useResource<TeamOverview>(
    user && canSeeTeamOverview ? '/v1/kpis/team-overview' : null,
  );

  // unmapped score-eligible questions + stale evaluation areas, org-wide
  const { data: measurementGaps } = useResource<MeasurementGaps>(
    user && canSeeTeamOverview ? '/v1/kpis/measurement-gaps' : null,
  );

  // recent context/comment feedback, org-wide — the qualitative signal
  // usually buried one entry at a time inside a person's own drawer
  const { data: recentFeedback } = useResource<RecentFeedback>(
    user && canSeeTeamOverview ? '/v1/kpis/recent-feedback' : null,
  );

  // weekly count of new submissions to a mapped form, org-wide
  const { data: activityTrend } = useResource<ActivityTrend>(
    user && canSeeTeamOverview ? '/v1/kpis/activity-trend' : null,
  );

  // fetched on demand when a team member row is clicked — their own scored
  // submissions, across every KPI that covers them
  const { data: memberBreakdown, error: memberBreakdownError } = useResource<TeamMemberBreakdown>(
    selectedMemberId ? `/v1/kpis/team-overview/${selectedMemberId}` : null,
  );
  // useResource keeps the previous response around until the next one lands —
  // guard against showing a just-clicked member's drawer with the last
  // member's stale breakdown while their own fetch is still in flight.
  const currentMemberBreakdown = memberBreakdown?.personId === selectedMemberId ? memberBreakdown : null;

  // cadence now lives on each Evaluation Area (a KPI can span several) — "level" filters
  // to KPIs that have at least one area on that cadence, rather than a single KPI-wide value
  const levels = useMemo(() => {
    if (!kpis) return [];
    return [...new Set(kpis.flatMap((k) => k.evaluationAreas.map((a) => a.cadence)))].sort();
  }, [kpis]);

  const levelData = useMemo(() => {
    if (!kpis) return [];
    return level === 'all' ? kpis : kpis.filter((k) => k.evaluationAreas.some((a) => a.cadence === level));
  }, [kpis, level]);

  const areasFlat = useMemo(
    () => levelData.flatMap((k) => k.evaluationAreas.map((a) => ({ ...a, kpiId: k.id, kpiName: k.name }))),
    [levelData],
  );
  const totalSubmissionCount = areasFlat.reduce((sum, a) => sum + a.recentSubmissions.length, 0);

  const teamMembers = teamOverview?.members ?? [];
  // Status strip: counts *people*, not KPI records — anyone with an active
  // KPI mapped to their role/department, bucketed by their own blended
  // score. Someone with no KPI mapped at all isn't "pending" here; that gap
  // is the separate "No KPI assigned" card below.
  const kpiCoveredMembers = useMemo(() => teamMembers.filter((m) => m.hasKpi), [teamMembers]);
  const stats = useMemo(() => {
    const counts: Record<StatusKey, number> = { outstanding: 0, meets: 0, improve: 0, below: 0, pending: 0 };
    kpiCoveredMembers.forEach((m) => counts[statusOf(m.score)]++);
    return counts;
  }, [kpiCoveredMembers]);
  // Each card's headline number is the *average* score of the people in that
  // band, not how many of them there are — the member count moves to
  // subtext instead. Pending has no score to average (statusOf(null) is the
  // only way into that band), so it keeps showing its member count.
  const bandScoreAvg = useMemo(() => {
    const scoresByStatus: Record<StatusKey, number[]> = {
      outstanding: [],
      meets: [],
      improve: [],
      below: [],
      pending: [],
    };
    kpiCoveredMembers.forEach((m) => {
      if (m.score !== null) scoresByStatus[statusOf(m.score)].push(m.score);
    });
    const avg: Record<StatusKey, number | null> = {
      outstanding: null,
      meets: null,
      improve: null,
      below: null,
      pending: null,
    };
    (Object.keys(scoresByStatus) as StatusKey[]).forEach((s) => {
      const scores = scoresByStatus[s];
      avg[s] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    });
    return avg;
  }, [kpiCoveredMembers]);

  const kpiTableData = useMemo(() => {
    let data = statusFilter === 'all' ? levelData : levelData.filter((k) => statusOf(k.latestValue) === statusFilter);
    data = [...data].sort((a, b) => {
      const dir = sort.dir;
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'updated':
        case 'latest':
        default: {
          const av = allSubmissions(a)[0]?.submittedAt ?? '';
          const bv = allSubmissions(b)[0]?.submittedAt ?? '';
          return av.localeCompare(bv) * dir;
        }
      }
    });
    return data;
  }, [levelData, statusFilter, sort]);

  // Tally each rater's reviewType across every area's most recent
  // submissions, so the dashboard shows the self/peer/manager/360 mix
  // behind the raw values above.
  const reviewMix = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const area of areasFlat) {
      for (const s of area.recentSubmissions) {
        counts[s.reviewType] = (counts[s.reviewType] ?? 0) + 1;
      }
    }
    return counts;
  }, [areasFlat]);
  const reviewMixTotal = Object.values(reviewMix).reduce((a, b) => a + b, 0);

  const submissionsByCadence = useMemo(() => {
    const groups = level === 'all' ? levels : [level];
    return groups.map((g) => ({
      label: CADENCE_LABEL[g] ?? g,
      count: areasFlat.filter((a) => a.cadence === g).reduce((sum, a) => sum + a.recentSubmissions.length, 0),
    }));
  }, [areasFlat, level, levels]);
  const hasSubmissionsByCadence = submissionsByCadence.some((g) => g.count > 0);

  const submissionsByPerson = useMemo(() => {
    const byPerson = new Map<string, number>();
    for (const area of areasFlat) {
      for (const s of area.recentSubmissions) {
        byPerson.set(s.personName, (byPerson.get(s.personName) ?? 0) + 1);
      }
    }
    return [...byPerson.entries()].map(([label, count]) => ({ label, count }));
  }, [areasFlat]);
  const hasSubmissionsByPerson = submissionsByPerson.length > 0;

  const noKpiMembers = useMemo(() => teamMembers.filter((m) => !m.hasKpi), [teamMembers]);
  const pendingMembers = useMemo(
    () => teamMembers.filter((m) => m.hasKpi && m.latestSubmission === null),
    [teamMembers],
  );

  // "Submissions by department": how many team members in each department
  // have at least one scored submission — a coverage view, not a performance one.
  const submissionsByDepartment = useMemo(() => {
    const byDept = new Map<string, number>();
    for (const m of teamMembers) {
      if (m.latestSubmission === null) continue;
      const key = m.department ?? 'no department';
      byDept.set(key, (byDept.get(key) ?? 0) + 1);
    }
    return [...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count }));
  }, [teamMembers]);
  const hasSubmissionsByDepartment = submissionsByDepartment.length > 0;

  const memberTableData = useMemo(() => {
    let data = teamMembers.filter((m) => {
      if (coverageFilterMatches(memberCoverageFilter, m.latestSubmission !== null) === false) return false;
      if (memberStatusFilter !== 'all' && statusOf(m.score) !== memberStatusFilter) return false;
      if (!memberFilter.trim()) return true;
      const haystack = `${m.displayName} ${m.email} ${m.department ?? ''} ${m.roles.join(' ')}`.toLowerCase();
      return haystack.includes(memberFilter.trim().toLowerCase());
    });
    data = [...data].sort((a, b) => {
      const dir = memberSort.dir;
      switch (memberSort.key) {
        case 'department':
          return (a.department ?? '').localeCompare(b.department ?? '') * dir;
        case 'trend': {
          const av = a.previousSubmission ? 1 : 0;
          const bv = b.previousSubmission ? 1 : 0;
          return (av - bv) * dir;
        }
        case 'updated':
        case 'latest':
          return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '') * dir;
        case 'name':
        default:
          return a.displayName.localeCompare(b.displayName) * dir;
      }
    });
    return data;
  }, [teamMembers, memberCoverageFilter, memberStatusFilter, memberFilter, memberSort]);

  function sortMembersBy(key: MemberSortKey) {
    setMemberSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  function onExportMembersCsv() {
    const header = ['name', 'email', 'department', 'roles', 'status', 'latest', 'last_updated'];
    const rows = memberTableData.map((m) => [
      m.displayName,
      m.email,
      m.department ?? '',
      m.roles.join('; '),
      STATUS_LABEL[statusOf(m.score)],
      m.latestSubmission?.display ?? '',
      m.lastUpdated ?? '',
    ]);
    downloadCsv('team-members-export.csv', [header, ...rows]);
  }

  function sortBy(key: KpiSortKey) {
    setSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  const selected = kpis?.find((k) => k.id === selectedId) ?? null;
  // This KPI's own review-type mix and anonymous rate, scoped to its own
  // recent submissions — distinct from the org-wide reviewMix above, which
  // is one flat tally across every KPI in the current cadence view.
  const selectedReviewStats = useMemo(() => {
    if (!selected) return { reviewMix: {} as Record<string, number>, anonymousRate: null as number | null };
    const counts: Record<string, number> = {};
    let anonymousCount = 0;
    let total = 0;
    for (const s of allSubmissions(selected)) {
      counts[s.reviewType] = (counts[s.reviewType] ?? 0) + 1;
      if (s.anonymous) anonymousCount += 1;
      total += 1;
    }
    return { reviewMix: counts, anonymousRate: total > 0 ? Math.round((anonymousCount / total) * 100) : null };
  }, [selected]);

  const drawerKpi: DrawerKpi | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        reviewMix: selectedReviewStats.reviewMix,
        anonymousRate: selectedReviewStats.anonymousRate,
        areas: selected.evaluationAreas.map((a) => ({
          id: a.id,
          name: a.name,
          cadence: CADENCE_LABEL[a.cadence] ?? a.cadence,
          submissions: a.recentSubmissions.map((s) => ({
            display: s.display,
            personName: s.personName,
            evaluatorName: s.enteredBy.displayName,
            reviewType: s.reviewType,
            anonymous: s.anonymous,
            context: s.context,
            comment: s.comment,
            submittedAt: s.submittedAt,
          })),
        })),
      }
    : null;

  const levelLabel = level === 'all' ? 'all cadences' : (CADENCE_LABEL[level] ?? level);

  return (
    <PortalShell user={user}>
      <div className="p-dashboard">
        <div className="page-title-row">
          <div>
            <h1>KPI dashboard</h1>
            <p className="portal-subtitle" style={{ margin: '4px 0 0' }}>
              {levelLabel} · click any card or row for details
            </p>
          </div>
        </div>

        {kpis && (
          <div className="p-filter-pills" style={{ marginBottom: 20 }}>
            <Badge asChild variant={level === 'all' ? 'default' : 'outline'} className="cursor-pointer py-1">
              <button onClick={() => setLevel('all')}>all levels ({kpis.length})</button>
            </Badge>
            {levels.map((l) => (
              <Badge key={l} asChild variant={level === l ? 'default' : 'outline'} className="cursor-pointer py-1">
                <button onClick={() => setLevel(l)}>
                  {CADENCE_LABEL[l] ?? l} ({kpis.filter((k) => k.evaluationAreas.some((a) => a.cadence === l)).length})
                </button>
              </Badge>
            ))}
          </div>
        )}

        {kpis === null ? (
          <div
            className="rounded-md border bg-card mt-4 mb-6 p-6"
            style={{ display: 'flex', justifyContent: 'center' }}
          >
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            {kpis.length === 0 && (
              <p className="muted" style={{ marginBottom: 12 }}>
                no KPIs assigned yet — an admin can map KPIs to your role or department under KPI settings. the widgets
                below will fill in as soon as one is.
              </p>
            )}
            {canSeeTeamOverview && teamOverview && (
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
                        ? 'no entries yet'
                        : `${stats[s]} member${stats[s] === 1 ? '' : 's'} · ${
                            kpiCoveredMembers.length ? Math.round((stats[s] / kpiCoveredMembers.length) * 100) : 0
                          }% of team`}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="p-card" style={{ marginBottom: 16 }}>
              <div className="p-card-title">Activity</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                <span className="p-score-ring p-status-meets" style={{ width: 64, height: 44, fontSize: 15 }}>
                  {totalSubmissionCount}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  scored submission{totalSubmissionCount === 1 ? '' : 's'} across {areasFlat.length} evaluation area
                  {areasFlat.length === 1 ? '' : 's'} in this view
                </span>
              </div>
              {reviewMixTotal > 0 && (
                <div className="p-legend-row">
                  {Object.entries(reviewMix).map(([type, count]) => (
                    <Badge key={type} variant="outline" className="py-1">
                      {REVIEW_TYPE_LABEL[type] ?? type}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {canSeeTeamOverview && teamOverview && (
              <div className="p-charts-row" style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  className="p-card"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => setMemberCoverageFilter('pending')}
                >
                  <div className="p-card-title">Pending evaluation</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                    <span className="p-score-ring p-status-pending" style={{ width: 64, height: 44, fontSize: 15 }}>
                      {pendingMembers.length}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      team members with a KPI mapped who haven&apos;t been scored yet, out of{' '}
                      {teamOverview.totalActiveUsers}
                    </span>
                  </div>
                  {pendingMembers.length > 0 && (
                    <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
                      {pendingMembers.slice(0, 8).map((m) => (
                        <li key={m.id}>{m.displayName}</li>
                      ))}
                      {pendingMembers.length > 8 && <li>…and {pendingMembers.length - 8} more</li>}
                    </ul>
                  )}
                </button>

                <div className="p-card">
                  <div className="p-card-title">No KPI assigned</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                    <span className="p-score-ring p-status-below" style={{ width: 64, height: 44, fontSize: 15 }}>
                      {noKpiMembers.length}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      team members whose role or department has no KPI mapped to it yet
                    </span>
                  </div>
                  {noKpiMembers.length > 0 && (
                    <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
                      {noKpiMembers.slice(0, 8).map((m) => (
                        <li key={m.id}>{m.displayName}</li>
                      ))}
                      {noKpiMembers.length > 8 && <li>…and {noKpiMembers.length - 8} more</li>}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {canSeeTeamOverview && teamOverview && (
              <div className="p-card" style={{ marginBottom: 16 }}>
                <div className="p-card-title">Submissions by department</div>
                {hasSubmissionsByDepartment ? (
                  <CountBarChart
                    data={submissionsByDepartment}
                    textColor="var(--text-3)"
                    gridColor="var(--border)"
                    barColor="var(--accent)"
                    countLabel="team members scored"
                  />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no scored team members yet.
                  </p>
                )}
              </div>
            )}

            {canSeeTeamOverview && measurementGaps && (
              <div className="p-charts-row" style={{ marginBottom: 16 }}>
                <div className="p-card">
                  <div className="p-card-title">Unmapped questions</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                    <span className="p-score-ring p-status-below" style={{ width: 64, height: 44, fontSize: 15 }}>
                      {measurementGaps.unmappedQuestions.total}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      score-eligible question{measurementGaps.unmappedQuestions.total === 1 ? '' : 's'} on a published
                      form that no KPI mapping points at
                    </span>
                  </div>
                  {measurementGaps.unmappedQuestions.items.length > 0 && (
                    <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
                      {measurementGaps.unmappedQuestions.items.slice(0, 8).map((q) => (
                        <li key={`${q.formSlug}-${q.fieldKey}`}>
                          <Link href={`/forms/view?slug=${q.formSlug}`}>{q.fieldLabel}</Link>{' '}
                          <span className="muted">· {q.formTitle}</span>
                        </li>
                      ))}
                      {measurementGaps.unmappedQuestions.total > 8 && (
                        <li>…and {measurementGaps.unmappedQuestions.total - 8} more</li>
                      )}
                    </ul>
                  )}
                </div>

                <div className="p-card">
                  <div className="p-card-title">Stale evaluation areas</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                    <span className="p-score-ring p-status-below" style={{ width: 64, height: 44, fontSize: 15 }}>
                      {measurementGaps.staleAreas.total}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      area{measurementGaps.staleAreas.total === 1 ? '' : 's'} not scored recently enough for their own
                      cadence
                    </span>
                  </div>
                  {measurementGaps.staleAreas.items.length > 0 && (
                    <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
                      {measurementGaps.staleAreas.items.slice(0, 8).map((a) => (
                        <li key={a.areaId}>
                          {a.kpiName} · {a.areaName}{' '}
                          <span className="muted">
                            (
                            {a.lastScoredAt
                              ? `last scored ${new Date(a.lastScoredAt).toLocaleDateString()}`
                              : 'never scored'}
                            )
                          </span>
                        </li>
                      ))}
                      {measurementGaps.staleAreas.total > 8 && (
                        <li>…and {measurementGaps.staleAreas.total - 8} more</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {canSeeTeamOverview && recentFeedback && recentFeedback.entries.length > 0 && (
              <div className="p-card" style={{ marginBottom: 16 }}>
                <div className="p-card-title">Recent feedback</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 380, overflowY: 'auto' }}>
                  {recentFeedback.entries.map((entry) => (
                    <div key={entry.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 3 }}>
                        {entry.kpiName} · {entry.areaName} — {entry.personName}
                        <span className="muted"> · {new Date(entry.createdAt).toLocaleDateString()}</span>
                      </div>
                      {entry.comment && <div style={{ fontSize: 13, fontStyle: 'italic' }}>“{entry.comment}”</div>}
                      {entry.context && (
                        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>context: {entry.context}</div>
                      )}
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                        by {entry.evaluatorName}
                        {entry.anonymous && ' (anonymous)'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canSeeTeamOverview && activityTrend && (
              <div className="p-card" style={{ marginBottom: 16 }}>
                <div className="p-card-title">Evaluation activity</div>
                {activityTrend.points.some((p) => p.count > 0) ? (
                  <ActivityTrendChart
                    data={activityTrend.points}
                    textColor="var(--text-3)"
                    gridColor="var(--border)"
                    barColor="var(--accent)"
                  />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no submissions to a mapped form in the last 12 weeks.
                  </p>
                )}
              </div>
            )}

            <div className="p-charts-row">
              <div className="p-card">
                <div className="p-card-title">Submissions by cadence</div>
                {hasSubmissionsByCadence ? (
                  <CountBarChart
                    data={submissionsByCadence}
                    textColor="var(--text-3)"
                    gridColor="var(--border)"
                    barColor="var(--accent)"
                  />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no scored submissions in this view yet.
                  </p>
                )}
              </div>

              <div className="p-card">
                <div className="p-card-title">Submissions by person</div>
                {hasSubmissionsByPerson ? (
                  <CountBarChart
                    data={submissionsByPerson}
                    textColor="var(--text-3)"
                    gridColor="var(--border)"
                    barColor="var(--accent)"
                  />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no scored submissions in this view yet.
                  </p>
                )}
              </div>
            </div>

            <div className="p-table-card">
              <div className="p-table-header">
                <div className="p-filter-pills">
                  {(['all', ...STATUS_ORDER] as const).map((s) => (
                    <Badge
                      key={s}
                      asChild
                      variant={statusFilter === s ? 'default' : 'outline'}
                      className="cursor-pointer py-1"
                    >
                      <button onClick={() => setStatusFilter(s)}>{s === 'all' ? 'All' : STATUS_LABEL[s]}</button>
                    </Badge>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: 11 }}>
                  sort: {sort.key} {sort.dir > 0 ? '↑' : '↓'}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="p-th-sortable"
                      aria-sort={sort.key === 'name' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('name')}>
                        name
                      </button>
                    </TableHead>
                    <TableHead>areas</TableHead>
                    <TableHead
                      className="p-th-sortable"
                      aria-sort={sort.key === 'latest' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('latest')}>
                        latest
                      </button>
                    </TableHead>
                    <TableHead>status</TableHead>
                    <TableHead
                      className="p-th-sortable"
                      aria-sort={sort.key === 'updated' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('updated')}>
                        last updated
                      </button>
                    </TableHead>
                    <TableHead>action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpiTableData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                        {kpis.length === 0 ? 'no KPIs assigned yet.' : 'no KPIs match this filter.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    kpiTableData.map((k) => {
                      const latest = allSubmissions(k)[0] ?? null;
                      const status = statusOf(k.latestValue);
                      return (
                        <TableRow
                          key={k.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`view ${k.name}`}
                          onClick={() => setSelectedId(k.id)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedId(k.id);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <TableCell style={{ fontWeight: 500 }}>{k.name}</TableCell>
                          <TableCell className="muted">{k.evaluationAreas.length}</TableCell>
                          <TableCell>
                            {latest ? (
                              <span className="p-score-ring p-status-meets">{latest.display}</span>
                            ) : (
                              <span className="p-score-ring p-status-pending">—</span>
                            )}
                            {latest && (
                              <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                                {latest.evaluationAreaName}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className="border-transparent" style={statusBadgeStyle(status)}>
                              {STATUS_LABEL[status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="muted" style={{ fontFamily: 'var(--mono)' }}>
                            {latest ? new Date(latest.submittedAt).toLocaleDateString() : '—'}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(k.id);
                              }}
                            >
                              View →
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <div className="p-table-footer">
                <span className="p-tf-count">
                  showing {kpiTableData.length} of {levelData.length} KPIs
                </span>
                <Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
                  clear filters
                </Button>
              </div>
            </div>

            {canSeeTeamOverview && teamOverview && (
              <div className="p-table-card" style={{ marginTop: 16 }}>
                <div className="p-table-header">
                  <div className="p-filter-pills">
                    {(['all', 'scored', 'pending'] as const).map((s) => (
                      <Badge
                        key={s}
                        asChild
                        variant={memberCoverageFilter === s ? 'default' : 'outline'}
                        className="cursor-pointer py-1"
                      >
                        <button onClick={() => setMemberCoverageFilter(s)}>{s === 'all' ? 'All' : s}</button>
                      </Badge>
                    ))}
                  </div>
                  <div className="p-filter-pills">
                    {(['all', ...STATUS_ORDER] as const).map((s) => (
                      <Badge
                        key={s}
                        asChild
                        variant={memberStatusFilter === s ? 'default' : 'outline'}
                        className="cursor-pointer py-1"
                      >
                        <button onClick={() => setMemberStatusFilter(s)}>
                          {s === 'all' ? 'All' : STATUS_LABEL[s]}
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <span className="muted" style={{ fontSize: 11 }}>
                    sort: {memberSort.key} {memberSort.dir > 0 ? '↑' : '↓'}
                  </span>
                </div>
                <div className="page-title-row" style={{ marginBottom: 8 }}>
                  <Input
                    aria-label="filter team members"
                    placeholder="filter by name, email, department, or role…"
                    value={memberFilter}
                    onChange={(e) => setMemberFilter(e.target.value)}
                    style={{ maxWidth: 320 }}
                  />
                  <Button variant="outline" size="sm" onClick={onExportMembersCsv}>
                    Export CSV
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="p-th-sortable"
                        aria-sort={
                          memberSort.key === 'name' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortMembersBy('name')}>
                          name
                        </button>
                      </TableHead>
                      <TableHead
                        className="p-th-sortable"
                        aria-sort={
                          memberSort.key === 'department' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortMembersBy('department')}>
                          department
                        </button>
                      </TableHead>
                      <TableHead>role</TableHead>
                      <TableHead>status</TableHead>
                      <TableHead
                        className="p-th-sortable"
                        aria-sort={
                          memberSort.key === 'latest' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortMembersBy('latest')}>
                          latest
                        </button>
                      </TableHead>
                      <TableHead
                        className="p-th-sortable"
                        aria-sort={
                          memberSort.key === 'trend' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortMembersBy('trend')}>
                          trend
                        </button>
                      </TableHead>
                      <TableHead
                        className="p-th-sortable"
                        aria-sort={
                          memberSort.key === 'updated' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortMembersBy('updated')}>
                          last updated
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberTableData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="muted" style={{ textAlign: 'center' }}>
                          {teamMembers.length === 0 ? 'no active team members.' : 'no team members match this filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      memberTableData.map((m) => {
                        const memberStatus = statusOf(m.score);
                        return (
                          <TableRow
                            key={m.id}
                            tabIndex={0}
                            role="button"
                            aria-label={`view ${m.displayName}'s rate`}
                            onClick={() => setSelectedMemberId(m.id)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedMemberId(m.id);
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <TableCell style={{ fontWeight: 500 }}>{m.displayName}</TableCell>
                            <TableCell className="muted">{m.department ?? '—'}</TableCell>
                            <TableCell className="muted">{m.roles.join(', ') || '—'}</TableCell>
                            <TableCell>
                              <Badge className="border-transparent" style={statusBadgeStyle(memberStatus)}>
                                {STATUS_LABEL[memberStatus]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {m.latestSubmission ? (
                                <span className="p-score-ring p-status-meets">{m.latestSubmission.display}</span>
                              ) : (
                                <span className="p-score-ring p-status-pending">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <TrendIndicator latest={m.latestSubmission} previous={m.previousSubmission} />
                            </TableCell>
                            <TableCell className="muted" style={{ fontFamily: 'var(--mono)' }}>
                              {m.lastUpdated ? new Date(m.lastUpdated).toLocaleDateString() : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                <div className="p-table-footer">
                  <span className="p-tf-count">
                    showing {memberTableData.length} of {teamMembers.length} team members
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMemberCoverageFilter('all');
                      setMemberStatusFilter('all');
                      setMemberFilter('');
                    }}
                  >
                    clear filters
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <KpiDetailDrawer kpi={drawerKpi} onClose={() => setSelectedId(null)} />
        <TeamMemberDetailDrawer
          breakdown={currentMemberBreakdown}
          loading={selectedMemberId !== null && currentMemberBreakdown === null && !memberBreakdownError}
          error={selectedMemberId !== null ? memberBreakdownError : null}
          onClose={() => setSelectedMemberId(null)}
        />
      </div>
    </PortalShell>
  );
}

function coverageFilterMatches(filter: CoverageFilter, isScored: boolean): boolean {
  if (filter === 'all') return true;
  return filter === 'scored' ? isScored : !isScored;
}
