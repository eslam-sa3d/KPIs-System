'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import type { TeamMemberBreakdown, TeamOverview } from '@pulse/contracts';
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
import {
  avg,
  computeKpi,
  latestAreaValue,
  latestPeriodEntries,
  previousAreaValue,
  round2,
  type ComputedKpi,
  type RawKpi,
} from './scoring';

// Lazy-loaded: recharts only ships once the dashboard actually renders a chart.
const KpiDistributionChart = dynamic(() => import('../../components/kpi-distribution-chart'), {
  ssr: false,
  loading: () => <LoadingState label="loading chart…" />,
});

type SortKey = 'name' | 'latestValue' | 'status' | 'updated';
type MemberSortKey = 'name' | 'department' | 'finalScore' | 'updated';

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

export default function DashboardPage() {
  const user = useSession();
  const [level, setLevel] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'latestValue', dir: -1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberStatusFilter, setMemberStatusFilter] = useState<StatusKey | 'all'>('all');
  const [memberSort, setMemberSort] = useState<{ key: MemberSortKey; dir: 1 | -1 }>({ key: 'finalScore', dir: -1 });
  const [memberFilter, setMemberFilter] = useState('');
  const canSeeTeamOverview = can(user, 'kpis:manage');

  const { data: rawKpis } = useResource<RawKpi[]>(user ? '/v1/kpis/my' : null);
  const kpis = useMemo(() => rawKpis?.map(computeKpi) ?? null, [rawKpis]);

  // org-wide roster with KPI coverage/final score/last-updated — admin-only, powers the team coverage cards and table below
  const { data: teamOverview } = useResource<TeamOverview>(
    user && canSeeTeamOverview ? '/v1/kpis/team-overview' : null,
  );

  // fetched on demand when a team member row is clicked — their own blended
  // rate per area, across every KPI that covers them
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
    return [...new Set(kpis.flatMap((k) => k.areas.map((a) => a.cadence)))].sort();
  }, [kpis]);

  const levelData = useMemo(() => {
    if (!kpis) return [];
    return level === 'all' ? kpis : kpis.filter((k) => k.areas.some((a) => a.cadence === level));
  }, [kpis, level]);

  const stats = useMemo(() => {
    const counts: Record<StatusKey, number> = { outstanding: 0, meets: 0, improve: 0, below: 0, pending: 0 };
    levelData.forEach((k) => counts[k.status]++);
    return counts;
  }, [levelData]);

  const tableData = useMemo(() => {
    let data = statusFilter === 'all' ? levelData : levelData.filter((k) => k.status === statusFilter);
    data = [...data].sort((a, b) => {
      const dir = sort.dir;
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'status':
          return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) * dir;
        case 'updated':
          return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '') * dir;
        case 'latestValue':
        default: {
          const av = a.latestValue;
          const bv = b.latestValue;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
      }
    });
    return data;
  }, [levelData, statusFilter, sort]);

  // "KPI status by cadence": groups EVALUATION AREAS (not KPIs — a KPI can span
  // several cadences) by their own cadence, stacking each area's latest status.
  const areaStatuses = useMemo(
    () => levelData.flatMap((k) => k.areas.map((a) => ({ cadence: a.cadence, status: statusOf(latestAreaValue(a)) }))),
    [levelData],
  );

  // Weighted composite: each scored KPI contributes latestValue × weight, where an
  // unweighted KPI (Kpi.weight left unset) defaults to a weight of 1 — an even
  // baseline against any KPI an admin has explicitly weighted heavier.
  const compositeScore = useMemo(() => {
    const scored = levelData.filter((k): k is ComputedKpi & { latestValue: number } => k.latestValue !== null);
    if (scored.length === 0) return null;
    const totalWeight = scored.reduce((sum, k) => sum + (k.weight ?? 1), 0);
    if (totalWeight === 0) return null;
    const weightedSum = scored.reduce((sum, k) => sum + k.latestValue * (k.weight ?? 1), 0);
    return round2(weightedSum / totalWeight);
  }, [levelData]);

  // Tally each rater's reviewType across every area's latest period, so the
  // dashboard shows the self/peer/manager/360 mix behind the numbers above.
  const reviewMix = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const kpi of levelData) {
      for (const area of kpi.areas) {
        for (const entry of latestPeriodEntries(area)) {
          const key = entry.reviewType ?? 'peer';
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [levelData]);
  const reviewMixTotal = Object.values(reviewMix).reduce((a, b) => a + b, 0);

  const distributionData = useMemo(() => {
    const groups = level === 'all' ? levels : [level];
    return groups.map((g) => {
      const inGroup = areaStatuses.filter((a) => a.cadence === g);
      return {
        level: CADENCE_LABEL[g] ?? g,
        outstanding: inGroup.filter((a) => a.status === 'outstanding').length,
        meets: inGroup.filter((a) => a.status === 'meets').length,
        improve: inGroup.filter((a) => a.status === 'improve').length,
        below: inGroup.filter((a) => a.status === 'below').length,
      };
    });
  }, [areaStatuses, level, levels]);

  const hasDistributionData = distributionData.some((g) => g.outstanding + g.meets + g.improve + g.below > 0);

  // "KPI by Person": each distinct evaluatee's own average latest score → status,
  // stacked into the same 4-tier bars as the cadence chart above (same component,
  // just grouped by person instead of cadence).
  const byPersonData = useMemo(() => {
    const byPerson = new Map<string, { name: string; values: number[] }>();
    for (const kpi of levelData) {
      for (const area of kpi.areas) {
        for (const entry of latestPeriodEntries(area)) {
          const bucket = byPerson.get(entry.person.id) ?? { name: entry.person.displayName, values: [] };
          bucket.values.push(Number(entry.value));
          byPerson.set(entry.person.id, bucket);
        }
      }
    }
    return [...byPerson.values()].map(({ name, values }) => {
      const status = statusOf(avg(values));
      return {
        level: name,
        outstanding: status === 'outstanding' ? 1 : 0,
        meets: status === 'meets' ? 1 : 0,
        improve: status === 'improve' ? 1 : 0,
        below: status === 'below' ? 1 : 0,
      };
    });
  }, [levelData]);

  const hasByPersonData = byPersonData.length > 0;

  const teamMembers = teamOverview?.members ?? [];
  const noKpiMembers = useMemo(() => teamMembers.filter((m) => !m.hasKpi), [teamMembers]);
  const pendingMembers = useMemo(() => teamMembers.filter((m) => m.hasKpi && m.finalScore === null), [teamMembers]);

  const memberTableData = useMemo(() => {
    let data = teamMembers.filter((m) => {
      if (memberStatusFilter !== 'all' && statusOf(m.finalScore) !== memberStatusFilter) return false;
      if (!memberFilter.trim()) return true;
      const haystack = `${m.displayName} ${m.email} ${m.department ?? ''} ${m.roles.join(' ')}`.toLowerCase();
      return haystack.includes(memberFilter.trim().toLowerCase());
    });
    data = [...data].sort((a, b) => {
      const dir = memberSort.dir;
      switch (memberSort.key) {
        case 'department':
          return (a.department ?? '').localeCompare(b.department ?? '') * dir;
        case 'updated':
          return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '') * dir;
        case 'finalScore': {
          const av = a.finalScore;
          const bv = b.finalScore;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        case 'name':
        default:
          return a.displayName.localeCompare(b.displayName) * dir;
      }
    });
    return data;
  }, [teamMembers, memberStatusFilter, memberFilter, memberSort]);

  function sortMembersBy(key: MemberSortKey) {
    setMemberSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  function onExportMembersCsv() {
    const header = ['name', 'email', 'department', 'roles', 'final_score', 'status', 'last_updated'];
    const rows = memberTableData.map((m) => [
      m.displayName,
      m.email,
      m.department ?? '',
      m.roles.join('; '),
      m.finalScore ?? '',
      STATUS_LABEL[statusOf(m.finalScore)],
      m.lastUpdated ?? '',
    ]);
    downloadCsv('team-members-export.csv', [header, ...rows]);
  }

  function sortBy(key: SortKey) {
    setSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  const selected = kpis?.find((k) => k.id === selectedId) ?? null;
  const drawerKpi: DrawerKpi | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        status: selected.status,
        areas: selected.areas.map((a) => ({
          id: a.id,
          name: a.name,
          cadence: CADENCE_LABEL[a.cadence] ?? a.cadence,
          latestValue: latestAreaValue(a),
          previousValue: previousAreaValue(a),
          entries: [...a.entries].reverse().map((e) => ({
            label: new Date(e.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            value: Number(e.value),
            personName: e.person.displayName,
            evaluatorName: e.enteredBy.displayName,
            reviewType: e.reviewType,
            anonymous: e.anonymous,
            context: e.context,
            comment: e.comment,
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
                  {CADENCE_LABEL[l] ?? l} ({kpis.filter((k) => k.areas.some((a) => a.cadence === l)).length})
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
            <div className="p-kpi-strip">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  className={`p-kpi-card p-status-${s}${statusFilter === s ? ' active' : ''}`}
                  onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                >
                  <div className="p-kpi-icon">{STATUS_ICON[s]}</div>
                  <div className="p-kpi-label">{STATUS_LABEL[s]}</div>
                  <div className="p-kpi-val">{stats[s]}</div>
                  <div className="p-kpi-sub">
                    {s === 'pending'
                      ? 'no entries yet'
                      : `${levelData.length ? Math.round((stats[s] / levelData.length) * 100) : 0}% of KPIs`}
                  </div>
                </button>
              ))}
            </div>

            <div className="p-card" style={{ marginBottom: 16 }}>
              <div className="p-card-title">Composite score</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                <span
                  className={`p-score-ring p-status-${statusOf(compositeScore)}`}
                  style={{ width: 64, height: 44, fontSize: 15 }}
                >
                  {compositeScore !== null ? compositeScore.toLocaleString() : '—'}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  weighted average of every scored KPI in this view (KPIs without a set weight count as 1)
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
                  onClick={() => setMemberStatusFilter('pending')}
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

            <div className="p-charts-row">
              <div className="p-card">
                <div className="p-card-title">KPI status by cadence</div>
                {hasDistributionData ? (
                  <>
                    <KpiDistributionChart data={distributionData} textColor="var(--text-3)" gridColor="var(--border)" />
                    <div className="p-legend-row">
                      <div className="p-legend-item">
                        <span className="p-legend-dot" style={{ background: 'var(--purple)' }} />
                        Outstanding
                      </div>
                      <div className="p-legend-item">
                        <span className="p-legend-dot" style={{ background: 'var(--green)' }} />
                        Meet expectations
                      </div>
                      <div className="p-legend-item">
                        <span className="p-legend-dot" style={{ background: 'var(--amber)' }} />
                        Needs improvement
                      </div>
                      <div className="p-legend-item">
                        <span className="p-legend-dot" style={{ background: 'var(--red)' }} />
                        Below expectations
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no scored KPIs in this view yet.
                  </p>
                )}
              </div>

              <div className="p-card">
                <div className="p-card-title">KPI by Person</div>
                {hasByPersonData ? (
                  <KpiDistributionChart data={byPersonData} textColor="var(--text-3)" gridColor="var(--border)" />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no scored KPIs in this view yet.
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
                      aria-sort={sort.key === 'latestValue' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => sortBy('latestValue')}>
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
                  {tableData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                        {kpis.length === 0 ? 'no KPIs assigned yet.' : 'no KPIs match this filter.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    tableData.map((k) => (
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
                        <TableCell className="muted">{k.areas.length}</TableCell>
                        <TableCell>
                          <span className={`p-score-ring p-status-${k.status}`}>
                            {k.latestValue !== null ? k.latestValue.toLocaleString() : '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className="border-transparent" style={statusBadgeStyle(k.status)}>
                            {STATUS_LABEL[k.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="muted" style={{ fontFamily: 'var(--mono)' }}>
                          {k.lastUpdated ? new Date(k.lastUpdated).toLocaleDateString() : '—'}
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
                    ))
                  )}
                </TableBody>
              </Table>
              <div className="p-table-footer">
                <span className="p-tf-count">
                  showing {tableData.length} of {levelData.length} KPIs
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
                      <TableHead
                        className="p-th-sortable"
                        aria-sort={
                          memberSort.key === 'finalScore' ? (memberSort.dir > 0 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortMembersBy('finalScore')}>
                          final score
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
                        <TableCell colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                          {teamMembers.length === 0 ? 'no active team members.' : 'no team members match this filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      memberTableData.map((m) => {
                        const status = statusOf(m.finalScore);
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
                              <span className={`p-score-ring p-status-${status}`}>
                                {m.finalScore !== null ? m.finalScore.toLocaleString() : '—'}
                              </span>
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
