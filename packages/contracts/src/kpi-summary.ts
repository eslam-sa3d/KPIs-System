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
