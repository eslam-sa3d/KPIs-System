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
