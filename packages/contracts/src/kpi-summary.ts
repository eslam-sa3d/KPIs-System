import { EvaluationAreaCadence } from './kpi';

/**
 * A KPI reduced to just what "link this to a KPI" pickers need: identity plus
 * its Evaluation Areas as selectable leaves. Projected from KpisService.list()
 * — shared verbatim so the KPI-link combobox, the form-builder's per-field KPI
 * link, and the KPI-mappings panel don't each hand-roll their own subset.
 */
export interface KpiOptionSummary {
  id: string;
  name: string;
  evaluationAreas: Array<{
    id: string;
    name: string;
    cadence: EvaluationAreaCadence;
    isActive: boolean;
  }>;
}

/** One row of KpisService.getTeamOverview()'s org-wide roster. */
export interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  department: string | null;
  roles: string[];
  hasKpi: boolean;
  /** null (not 0) when the person has never been scored — "pending", not "scored a 0". */
  finalScore: number | null;
  /** The same blend as finalScore, one period back — null when there isn't a
   *  prior period yet for any area, not when the change happens to be zero.
   *  Powers the team table's trend indicator (finalScore vs. previousScore). */
  previousScore: number | null;
  lastUpdated: string | null;
}

/** Response of GET /v1/kpis/team-overview — shared verbatim between
 *  KpisService.getTeamOverview() and the dashboard's admin team view. */
export interface TeamOverview {
  totalActiveUsers: number;
  members: TeamMember[];
}

/** One Evaluation Area's blended rate for a single team member — the same
 *  multi-rater average used everywhere else (see latestAreaValue client-side,
 *  or the equivalent blending in getTeamOverview), not split out per rater. */
export interface TeamMemberKpiArea {
  id: string;
  name: string;
  cadence: EvaluationAreaCadence;
  latestValue: number | null;
  previousValue: number | null;
}

export interface TeamMemberKpi {
  id: string;
  name: string;
  areas: TeamMemberKpiArea[];
}

/** Response of GET /v1/kpis/team-overview/:personId — a single team member's
 *  own rate across every KPI that covers them, for the dashboard's team
 *  member detail drawer. */
export interface TeamMemberBreakdown {
  personId: string;
  displayName: string;
  kpis: TeamMemberKpi[];
}

/** A score-eligible question on a published form with no FormKpiMapping
 *  pointing at it yet — a question built to grade something, whose answers
 *  never reach a KPI. */
export interface UnmappedQuestion {
  formSlug: string;
  formTitle: string;
  fieldKey: string;
  fieldLabel: string;
}

/** An active Evaluation Area that hasn't been scored in longer than its own
 *  cadence reasonably allows (a grace period beyond one full cycle) —
 *  `lastScoredAt` is null when it's never been scored at all, distinct from
 *  "went quiet after being scored." */
export interface StaleKpiArea {
  kpiId: string;
  kpiName: string;
  areaId: string;
  areaName: string;
  cadence: EvaluationAreaCadence;
  lastScoredAt: string | null;
}

/** Response of GET /v1/kpis/measurement-gaps — org-wide signals for "are we
 *  actually measuring what we think we are," distinct from per-person
 *  "pending evaluation" (which only catches a gap for one person at a time). */
export interface MeasurementGaps {
  unmappedQuestions: { total: number; items: UnmappedQuestion[] };
  staleAreas: { total: number; items: StaleKpiArea[] };
}

/** One entry's free-text context/comment, for the dashboard's qualitative
 *  feedback digest — respects the same anonymity rule as everywhere else
 *  (evaluatorName withheld for a caller without kpis:manage when the
 *  originating mapping marked it anonymous). */
export interface FeedbackEntry {
  id: string;
  kpiId: string;
  kpiName: string;
  areaName: string;
  personName: string;
  evaluatorName: string;
  anonymous: boolean;
  context: string | null;
  comment: string | null;
  createdAt: string;
}

/** Response of GET /v1/kpis/recent-feedback. */
export interface RecentFeedback {
  entries: FeedbackEntry[];
}

/** One point in the org-wide evaluation activity trend — a count of new
 *  Evaluation Area entries recorded in that week. */
export interface ActivityTrendPoint {
  /** ISO date (Monday) of the week this point covers. */
  weekStart: string;
  count: number;
}

/** Response of GET /v1/kpis/activity-trend. */
export interface ActivityTrend {
  points: ActivityTrendPoint[];
}
