'use client';

import { useMemo, useState } from 'react';
import type {
  DashboardFormScope,
  FormListItem,
  RecentFeedback,
  TeamMemberBreakdown,
  TeamOverview,
} from '@pulse/contracts';
import { PortalShell, can } from '../../components/portal-shell';
import { TeamMemberDetailDrawer } from '../../components/team-member-detail-drawer';
import { Spinner } from '@/components/ui/spinner';
import { api } from '../../lib/api-client';
import { useSession } from '../../lib/use-session';
import { useResource } from '../../lib/use-resource';
import { BandKey, PerformanceLevelOption, bandOf, orderedBands } from '../../lib/performance-band';
import { DashboardFormScopePicker } from './dashboard-form-scope-picker';
import { DashboardJobTitlePills } from './dashboard-job-title-pills';
import { DashboardStatusCards } from './dashboard-status-cards';
import { DashboardScoreChart } from './dashboard-score-chart';
import { DashboardRecentFeedback } from './dashboard-recent-feedback';
import { DashboardTeamTable } from './dashboard-team-table';

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
  const [memberStatusFilter, setMemberStatusFilter] = useState<BandKey | 'all'>('all');
  const [memberSort, setMemberSort] = useState<{ key: MemberSortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 });
  const [memberFilter, setMemberFilter] = useState('');
  const canSeeTeamOverview = can(user, 'dashboards:view');

  const { data: kpis, reload: reloadKpis } = useResource<RawKpi[]>(user ? '/v1/kpis/my' : null);
  // Admin-configured Performance Levels — the status strip, filter pills,
  // and each row's status badge are all driven by these, never a fixed set
  // of bands, so the dashboard always reflects whatever's actually
  // configured on the Configuration page.
  const { data: performanceLevels } = useResource<PerformanceLevelOption[]>(user ? '/v1/performance-levels' : null);
  const levels = performanceLevels ?? [];
  const bands = useMemo(() => orderedBands(levels), [levels]);

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
      setFormScopeError(cause instanceof Error ? cause.message : 'The request failed');
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

  // Status strip: counts *people*, bucketed by their own latestScore's
  // matched Performance Level — bandOf(m) is the exact same rule the team
  // table below uses per row, so the cards and the table always agree.
  const stats = useMemo(() => {
    const counts: Record<BandKey, number> = {};
    bands.forEach((b) => (counts[b.key] = 0));
    filteredTeamMembers.forEach((m) => {
      const key = bandOf(m);
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [filteredTeamMembers, bands]);
  // Each card's headline number is the *average* latestScore of the people
  // in that band, not how many of them there are — the member count moves
  // to subtext instead. Pending has no score to average, so it keeps
  // showing its member count; Unranked does have real latestScores to
  // average even though none matched a configured range.
  const bandScoreAvg = useMemo(() => {
    const scoresByBand: Record<BandKey, number[]> = {};
    bands.forEach((b) => (scoresByBand[b.key] = []));
    filteredTeamMembers.forEach((m) => {
      if (m.latestScore !== null) {
        const key = bandOf(m);
        (scoresByBand[key] ??= []).push(m.latestScore);
      }
    });
    const avg: Record<BandKey, number | null> = {};
    bands.forEach((b) => {
      const scores = scoresByBand[b.key] ?? [];
      avg[b.key] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    });
    return avg;
  }, [filteredTeamMembers, bands]);

  // Each scored member's own latestScore — one bar per person, distinct from
  // "submissions by person" below which counts raw activity, not this value.
  const scoreByPerson = useMemo(() => {
    return filteredTeamMembers
      .filter((m): m is typeof m & { latestScore: number } => m.latestScore !== null)
      .map((m) => ({ label: m.displayName, count: Math.round(m.latestScore * 10) / 10 }))
      .sort((a, b) => b.count - a.count);
  }, [filteredTeamMembers]);
  const hasScoreByPerson = scoreByPerson.length > 0;

  const memberTableData = useMemo(() => {
    let data = filteredTeamMembers.filter((m) => {
      if (coverageFilterMatches(memberCoverageFilter, m.latestSubmission !== null) === false) return false;
      if (memberStatusFilter !== 'all' && bandOf(m) !== memberStatusFilter) return false;
      if (!memberFilter.trim()) return true;
      const haystack = `${m.displayName} ${m.email} ${m.department ?? ''} ${m.jobTitle ?? ''}`.toLowerCase();
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

  return (
    <PortalShell user={user}>
      <div className="p-dashboard">
        <div className="page-title-row">
          <div>
            <h1>KPI dashboard</h1>
            <p className="portal-subtitle" style={{ margin: '4px 0 0' }}>
              Click any card or row for details
            </p>
          </div>
        </div>

        <DashboardFormScopePicker
          canSeeTeamOverview={canSeeTeamOverview}
          formScope={formScope}
          scopeForms={scopeForms}
          selectedFormIds={selectedFormIds}
          canEditFormScope={canEditFormScope}
          onToggleScopeForm={onToggleScopeForm}
          formScopeSaving={formScopeSaving}
          onShowAllForms={() => void persistFormScope([])}
          formScopeError={formScopeError}
        />

        <DashboardJobTitlePills
          show={Boolean(canSeeTeamOverview && teamOverview)}
          jobTitleOptions={jobTitleOptions}
          jobTitleFilter={jobTitleFilter}
          setJobTitleFilter={setJobTitleFilter}
          teamMembers={teamMembers}
        />

        {kpis === null ? (
          <div
            className="rounded-md border bg-card mt-4 mb-6 p-6"
            style={{ display: 'flex', justifyContent: 'center' }}
          >
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            <DashboardStatusCards
              show={Boolean(canSeeTeamOverview && teamOverview)}
              bands={bands}
              levels={levels}
              memberStatusFilter={memberStatusFilter}
              setMemberStatusFilter={setMemberStatusFilter}
              bandScoreAvg={bandScoreAvg}
              stats={stats}
              filteredTeamMemberCount={filteredTeamMembers.length}
            />

            <DashboardScoreChart
              show={Boolean(canSeeTeamOverview && teamOverview)}
              scoreByPerson={scoreByPerson}
              hasScoreByPerson={hasScoreByPerson}
            />

            <DashboardRecentFeedback canSeeTeamOverview={canSeeTeamOverview} recentFeedback={recentFeedback} />

            <DashboardTeamTable
              show={Boolean(canSeeTeamOverview && teamOverview)}
              bands={bands}
              levels={levels}
              memberCoverageFilter={memberCoverageFilter}
              setMemberCoverageFilter={setMemberCoverageFilter}
              memberStatusFilter={memberStatusFilter}
              setMemberStatusFilter={setMemberStatusFilter}
              memberSort={memberSort}
              sortMembersBy={sortMembersBy}
              memberFilter={memberFilter}
              setMemberFilter={setMemberFilter}
              memberTableData={memberTableData}
              totalTeamMemberCount={teamMembers.length}
              filteredTeamMemberCount={filteredTeamMembers.length}
              onSelectMember={setSelectedMemberId}
              onClearFilters={() => {
                setMemberCoverageFilter('all');
                setMemberStatusFilter('all');
                setMemberFilter('');
              }}
            />
          </>
        )}

        <TeamMemberDetailDrawer
          breakdown={currentMemberBreakdown}
          levels={levels}
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
