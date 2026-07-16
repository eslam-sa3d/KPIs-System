export interface SubCriteriaRow {
  id: string;
  name: string;
}

export interface EvaluationAreaRow {
  id: string;
  name: string;
  cadence: string;
  isActive: boolean;
  subCriteria: SubCriteriaRow[];
}

export interface KpiAssignmentRow {
  id: string;
  roleId: string | null;
  departmentId: string | null;
  deliveryStream: string | null;
}

export interface KpiRow {
  id: string;
  name: string;
  /** Relative importance as a percentage (0-100) — informational only. */
  weight: number | null;
  isActive: boolean;
  evaluationAreas: EvaluationAreaRow[];
  /** Which roles/departments/delivery streams see this KPI on their own
   *  dashboard — /v1/kpis/my filters on this unconditionally, even for an
   *  admin, so an unassigned KPI never appears there regardless of scoring. */
  assignments: KpiAssignmentRow[];
}

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface RoleOption {
  id: string;
  name: string;
}
