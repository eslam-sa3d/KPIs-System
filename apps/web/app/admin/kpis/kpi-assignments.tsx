import { EyeOff, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DepartmentOption, KpiAssignmentRow, RoleOption } from './types';

/** Department/role assignment badges for the selected KPI, plus the two
 *  "Assign to X" inline pickers used to add more. */
export function KpiAssignments({
  kpiId,
  assignments,
  departments,
  roles,
  canManage,
  assignmentLabel,
  confirmUnassignId,
  setConfirmUnassignId,
  onUnassignKpi,
  assigningKpiId,
  setAssigningKpiId,
  assignTarget,
  setAssignTarget,
  onAssignKpi,
  assigningRoleKpiId,
  setAssigningRoleKpiId,
  assignRoleTarget,
  setAssignRoleTarget,
  onAssignKpiRole,
}: {
  kpiId: string;
  assignments: KpiAssignmentRow[];
  departments: DepartmentOption[];
  roles: RoleOption[];
  canManage: boolean;
  assignmentLabel: (a: KpiAssignmentRow) => string;
  confirmUnassignId: string | null;
  setConfirmUnassignId: (id: string | null) => void;
  onUnassignKpi: (kpiId: string, assignmentId: string) => void;
  assigningKpiId: string | null;
  setAssigningKpiId: (id: string | null) => void;
  assignTarget: string;
  setAssignTarget: (value: string) => void;
  onAssignKpi: (kpiId: string) => void;
  assigningRoleKpiId: string | null;
  setAssigningRoleKpiId: (id: string | null) => void;
  assignRoleTarget: string;
  setAssignRoleTarget: (value: string) => void;
  onAssignKpiRole: (kpiId: string) => void;
}) {
  return (
    <div className="kpi-assignments">
      <span className="field-label">Assigned to</span>
      {assignments.length === 0 ? (
        <p className="empty-state-inline">
          <EyeOff size={14} aria-hidden="true" />
          Not assigned to a department or role — only visible here on the admin page
        </p>
      ) : (
        <span className="row-actions">
          {assignments.map((a) => (
            <Badge key={a.id} variant="outline" className="gap-1.5 py-0.5 text-xs">
              {assignmentLabel(a)}
              {canManage &&
                (confirmUnassignId === a.id ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Confirm remove"
                      onClick={() => onUnassignKpi(kpiId, a.id)}
                    >
                      ✓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Cancel remove"
                      onClick={() => setConfirmUnassignId(null)}
                    >
                      ✕
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${assignmentLabel(a)} assignment`}
                    onClick={() => setConfirmUnassignId(a.id)}
                  >
                    ✕
                  </Button>
                ))}
            </Badge>
          ))}
        </span>
      )}
      {canManage &&
        (assigningKpiId === kpiId ? (
          <span className="inline-form">
            <Select value={assignTarget} onValueChange={setAssignTarget}>
              <SelectTrigger aria-label="Assign to department">
                <SelectValue placeholder="Choose a department…" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" disabled={!assignTarget} onClick={() => onAssignKpi(kpiId)}>
              Assign
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAssigningKpiId(null);
                setAssignTarget('');
              }}
            >
              Close
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => setAssigningKpiId(kpiId)}
          >
            <Plus size={14} aria-hidden="true" />
            Assign to department
          </Button>
        ))}
      {canManage &&
        (assigningRoleKpiId === kpiId ? (
          <span className="inline-form">
            <Select value={assignRoleTarget} onValueChange={setAssignRoleTarget}>
              <SelectTrigger aria-label="Assign to role">
                <SelectValue placeholder="Choose a role…" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" disabled={!assignRoleTarget} onClick={() => onAssignKpiRole(kpiId)}>
              Assign
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAssigningRoleKpiId(null);
                setAssignRoleTarget('');
              }}
            >
              Close
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => setAssigningRoleKpiId(kpiId)}
          >
            <Plus size={14} aria-hidden="true" />
            Assign to role
          </Button>
        ))}
    </div>
  );
}
