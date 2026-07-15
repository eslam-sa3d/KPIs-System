'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import type { DashboardFormScope, FormListItem, RecentFeedback, TeamMemberBreakdown, TeamOverview } from '@pulse/contracts';
import { PortalShell, can } from '../../components/portal-shell';
import { TeamMemberDetailDrawer } from '../../components/team-member-detail-drawer';
import { FormMultiSelectCombobox } from '../../components/form-multi-select-combobox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import { useResource } from '../../lib/use-resource';
import { useReveal } from '../../lib/use-reveal';
import { STATUS_ICON, STATUS_LABEL, STATUS_ORDER, StatusKey, statusBadgeStyle, statusOf } from '../../lib/kpi-status';

// Lazy-loaded: recharts only ships once the dashboard actually renders a chart.
const CountBarChart = dynamic(() => import('../../components/count-bar-chart'), {
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

type MemberSortKey = 'name' | 'department' | 'updated';
type CoverageFilter = 'all' | 'scored' | 'pending';

export default function DashboardPage() {
  const user = useSession();
  const [jobTitleFilter, setJobTitleFilter] = useState('all');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberCoverageFilter, setMemberCoverageFilter] = useState<CoverageFilter>('all');
  const [memberStatusFilter, setMemberStatusFilter] = useState<StatusKey | 'all'>('all');
  const [memberSort, setMemberSort] = useState<{ key: MemberSortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 });
  const [memberFilter, setMemberFilter] = useState('');
  const canSeeTeamOverview = can(user, 'dashboards:view');

  const { data: kpis, reload: reloadKpis } = useResource<RawKpi[]>(user ? '/v1/kpis/my' : null);

  // org-wide roster with KPI coverage/latest submission/last-updated — admin-only, powers the team coverage cards and table below
  const { data: teamOverview, reload: reloadTeamOverview } = useResource<TeamOverview>(
    user && canSeeTeamOverview ? '/v1/kpis/team-overview' : null,
  );

  // recent context/comment feedback, org-wide — the qualitative signal
  // usually buried one entry at a time inside a person's own drawer
  const { data: recentFeedback, reload: reloadRecentFeedback } = useResource<RecentFeedback>(
    user && canSeeTeamOverview ? '/v1/kpis/recent-feedback' : null,
  );

  // which forms' submissions currently feed the dashboard — global,
  // admin-managed, shared across every user (see DashboardFormScope)
  const canEditFormScope = can(user, 'dashboards:edit');
  const { data: formScope, setData: setFormScope } = useResource<DashboardFormScope>(
    user && canSeeTeamOverview ? '/v1/kpis/dashboard-form-scope' : null,
  );
  const { data: scopeForms } = useResource<FormListItem[]>(user && canSeeTeamOverview ? '/v1/forms' : null);
  const [formScopeSaving, setFormScopeSaving] = useState(false);
  const [formScopeError, setFormScopeError] = useState<string | null>(null);
  const selectedFormIds = useMemo(() => new Set(formScope?.formIds ?? []), [formScope]);

  async function persistFormScope(formIds: string[]) {
    setFormScopeSaving(true);
    setFormScopeError(null);
    try {
      const updated = await api<DashboardFormScope>('/v1/kpis/dashboard-form-scope', {
        method: 'PUT',
        body: JSON.stringify({ formIds }),
      });
      setFormScope(updated);
      // The scope affects almost every widget below — refresh them all.
      void reloadKpis();
      void reloadTeamOverview();
      void reloadRecentFeedback();
    } catch (cause) {
      setFormScopeError(cause instanceof Error ? cause.message : 'the request failed');
    } finally {
      setFormScopeSaving(false);
    }
  }

  function onToggleScopeForm(form: FormListItem) {
    const next = new Set(selectedFormIds);
    if (next.has(form.id)) next.delete(form.id);
    else next.add(form.id);
    void persistFormScope([...next]);
  }

  // fetched on demand when a team member row is clicked — their own scored
  // submissions, across every KPI that covers them
  const { data: memberBreakdown, error: memberBreakdownError } = useResource<TeamMemberBreakdown>(
    selectedMemberId ? `/v1/kpis/team-overview/${selectedMemberId}` : null,
  );
  // useResource keeps the previous response around until the next one lands —
  // guard against showing a just-clicked member's drawer with the last
  // member's stale breakdown while their own fetch is still in flight.
  const currentMemberBreakdown = memberBreakdown?.personId === selectedMemberId ? memberBreakdown : null;

  const teamMembers = teamOverview?.members ?? [];

  // Distinct job titles actually present among the team, for the filter
  // pills — "all job titles" plus one pill per title in use, each showing
  // how many members carry it (mirrors the cadence pills' own pattern above).
  const jobTitleOptions = useMemo(() => {
    const set = new Set(teamMembers.map((m) => m.jobTitle).filter((t): t is string => Boolean(t)));
    return [...set].sort();
  }, [teamMembers]);

  // The one filtered population every dashboard widget below reads from —
  // status cards, the score chart, and the team table all derive from this
  // same list, so a card's count and the table's rows can never disagree.
  const filteredTeamMembers = useMemo(() => {
    if (jobTitleFilter === 'all') return teamMembers;
    return teamMembers.filter((m) => m.jobTitle === jobTitleFilter);
  }, [teamMembers, jobTitleFilter]);

  // Status strip: counts *people*, bucketed by their own blended score —
  // statusOf(null) buckets anyone never scored into "pending", exactly the
  // same statusOf(m.score) call the team table below uses per row, so the
  // cards and the table always agree.
  const stats = useMemo(() => {
    const counts: Record<StatusKey, number> = { outstanding: 0, meets: 0, improve: 0, below: 0, pending: 0 };
    filteredTeamMembers.forEach((m) => counts[statusOf(m.score)]++);
    return counts;
  }, [filteredTeamMembers]);
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
    filteredTeamMembers.forEach((m) => {
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
  }, [filteredTeamMembers]);

  // Each scored member's own overall blended score (0-5) — one bar per
  // person, distinct from "submissions by person" below which counts raw
  // activity, not this normalized score.
  const scoreByPerson = useMemo(() => {
    return filteredTeamMembers
      .filter((m): m is typeof m & { score: number } => m.score !== null)
      .map((m) => ({ label: m.displayName, count: Math.round(m.score * 10) / 10 }))
      .sort((a, b) => b.count - a.count);
  }, [filteredTeamMembers]);
  const hasScoreByPerson = scoreByPerson.length > 0;

  const memberTableData = useMemo(() => {
    let data = filteredTeamMembers.filter((m) => {
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
        case 'updated':
          return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '') * dir;
        case 'name':
        default:
          return a.displayName.localeCompare(b.displayName) * dir;
      }
    });
    return data;
  }, [filteredTeamMembers, memberCoverageFilter, memberStatusFilter, memberFilter, memberSort]);

  function sortMembersBy(key: MemberSortKey) {
    setMemberSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  }

  const dashboardRef = useReveal<HTMLDivElement>('.p-kpi-card, .p-card, .p-table-card', kpis !== null);

  return (
    <PortalShell user={user}>
      <div className="p-dashboard" ref={dashboardRef}>
        <div className="page-title-row">
          <div>
            <h1>KPI dashboard</h1>
            <p className="portal-subtitle" style={{ margin: '4px 0 0' }}>
              click any card or row for details
            </p>
          </div>
        </div>

        {canSeeTeamOverview && (
          <div
            className="p-card"
            style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
          >
            <span className="muted">
              showing data from:{' '}
              {formScope === null
                ? 'loading…'
                : selectedFormIds.size === 0
                  ? 'all forms'
                  : [...selectedFormIds].map((id) => scopeForms?.find((f) => f.id === id)?.title ?? id).join(', ')}
            </span>
            {canEditFormScope && (
              <>
                <FormMultiSelectCombobox
                  selectedIds={selectedFormIds}
                  onToggle={onToggleScopeForm}
                  disabled={formScopeSaving}
                  triggerLabel="choose a form"
                />
                {selectedFormIds.size > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={formScopeSaving}
                    onClick={() => void persistFormScope([])}
                  >
                    show all forms
                  </Button>
                )}
                {formScopeSaving && <Spinner className="size-4" />}
              </>
            )}
          </div>
        )}
        {formScopeError && (
          <Alert variant="destructive" style={{ marginBottom: 16 }}>
            <AlertDescription>{formScopeError}</AlertDescription>
          </Alert>
        )}

        {canSeeTeamOverview && teamOverview && jobTitleOptions.length > 0 && (
          <div className="p-filter-pills" style={{ marginBottom: 20 }}>
            <Badge asChild variant={jobTitleFilter === 'all' ? 'default' : 'outline'} className="cursor-pointer py-1">
              <button onClick={() => setJobTitleFilter('all')}>all job titles ({teamMembers.length})</button>
            </Badge>
            {jobTitleOptions.map((title) => (
              <Badge
                key={title}
                asChild
                variant={jobTitleFilter === title ? 'default' : 'outline'}
                className="cursor-pointer py-1"
              >
                <button onClick={() => setJobTitleFilter(title)}>
                  {title} ({teamMembers.filter((m) => m.jobTitle === title).length})
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
                            filteredTeamMembers.length ? Math.round((stats[s] / filteredTeamMembers.length) * 100) : 0
                          }% of team`}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {canSeeTeamOverview && teamOverview && (
              <div className="p-card" style={{ marginBottom: 16 }}>
                <div className="p-card-title">Score by team member</div>
                {hasScoreByPerson ? (
                  <CountBarChart
                    data={scoreByPerson}
                    textColor="var(--text-3)"
                    gridColor="var(--border)"
                    barColor="var(--accent)"
                    countLabel="score / 5"
                  />
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>
                    no scored team members yet.
                  </p>
                )}
              </div>
            )}

            {canSeeTeamOverview && recentFeedback && recentFeedback.entries.length > 0 && (
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

            {canSeeTeamOverview && teamOverview && (
              <div className="p-table-card">
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
                      <TableHead>score</TableHead>
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
                        <TableCell colSpan={6} className="muted" style={{ textAlign: 'center' }}>
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
                            <TableCell className="muted" style={{ fontFamily: 'var(--mono)' }}>
                              {m.score !== null ? `${m.score.toFixed(1)} / 5` : '—'}
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
                    showing {memberTableData.length} of {filteredTeamMembers.length} team members
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

        <TeamMemberDetailDrawer
          breakdown={currentMemberBreakdown}
          score={teamMembers.find((m) => m.id === selectedMemberId)?.score ?? null}
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
