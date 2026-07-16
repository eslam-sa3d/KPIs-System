import { FormEvent } from 'react';
import { Layers, ListPlus, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill, WeightRing, pluralize } from './kpi-widgets';
import type { EvaluationAreaRow } from './types';

/** One Evaluation Area row (rename/toggle/delete) plus its nested
 *  Sub-Criteria list (each with its own rename/delete) and the "add
 *  sub-criteria" inline form. */
export function EvaluationAreaCard({
  kpiId,
  area,
  weightShare,
  canWrite,
  canManage,
  canToggleStatus,
  renamingAreaId,
  setRenamingAreaId,
  confirmDeleteAreaId,
  setConfirmDeleteAreaId,
  addingSubCriteriaForAreaId,
  setAddingSubCriteriaForAreaId,
  renamingSubCriteriaId,
  setRenamingSubCriteriaId,
  confirmDeleteSubCriteriaId,
  setConfirmDeleteSubCriteriaId,
  onRenameArea,
  onToggleAreaActive,
  onDeleteArea,
  onCreateSubCriteria,
  onRenameSubCriteria,
  onDeleteSubCriteria,
}: {
  kpiId: string;
  area: EvaluationAreaRow;
  /** KPI weight split evenly across all of its evaluation areas — purely a
   *  display derived from the KPI's own weight, not a value stored per area.
   *  Null when the KPI has no weight set. */
  weightShare: number | null;
  canWrite: boolean;
  canManage: boolean;
  canToggleStatus: boolean;
  renamingAreaId: string | null;
  setRenamingAreaId: (id: string | null) => void;
  confirmDeleteAreaId: string | null;
  setConfirmDeleteAreaId: (id: string | null) => void;
  addingSubCriteriaForAreaId: string | null;
  setAddingSubCriteriaForAreaId: (id: string | null) => void;
  renamingSubCriteriaId: string | null;
  setRenamingSubCriteriaId: (id: string | null) => void;
  confirmDeleteSubCriteriaId: string | null;
  setConfirmDeleteSubCriteriaId: (id: string | null) => void;
  onRenameArea: (kpiId: string, areaId: string, event: FormEvent<HTMLFormElement>) => void;
  onToggleAreaActive: (kpiId: string, area: EvaluationAreaRow) => void;
  onDeleteArea: (kpiId: string, areaId: string) => void;
  onCreateSubCriteria: (kpiId: string, areaId: string, event: FormEvent<HTMLFormElement>) => void;
  onRenameSubCriteria: (
    kpiId: string,
    areaId: string,
    subCriteriaId: string,
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onDeleteSubCriteria: (kpiId: string, areaId: string, subCriteriaId: string) => void;
}) {
  return (
    <div className="builder-field kpi-area">
      {renamingAreaId === area.id ? (
        <form className="inline-form" onSubmit={(e) => onRenameArea(kpiId, area.id, e)}>
          <Input
            name="name"
            defaultValue={area.name}
            required
            minLength={2}
            aria-label="Evaluation area name"
            autoFocus
          />
          <Button type="submit" variant="ghost">
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRenamingAreaId(null)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="kpi-area-head hover-actions-row">
          <div className="hierarchy-title-row">
            {weightShare !== null ? (
              <WeightRing value={weightShare} size="sm" />
            ) : (
              <span className="hierarchy-icon hierarchy-icon-sm">
                <Layers size={15} aria-hidden="true" />
              </span>
            )}
            <strong>{area.name}</strong>
            {area.subCriteria.length > 0 && (
              <span className="muted">{pluralize(area.subCriteria.length, 'sub-criteria', 'sub-criteria')}</span>
            )}
          </div>
          {canWrite && (
            <span className="hover-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Rename ${area.name}`}
                onClick={() => setRenamingAreaId(area.id)}
              >
                <Pencil size={14} aria-hidden="true" />
              </Button>
              <StatusPill
                isActive={area.isActive}
                onToggle={() => onToggleAreaActive(kpiId, area)}
                size="sm"
                disabled={!canToggleStatus}
              />
              {canManage &&
                (confirmDeleteAreaId === area.id ? (
                  <>
                    <span className="muted">Delete permanently?</span>
                    <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteArea(kpiId, area.id)}>
                      Confirm delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-primary hover:text-primary"
                      onClick={() => setConfirmDeleteAreaId(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDeleteAreaId(area.id)}
                  >
                    Delete
                  </Button>
                ))}
            </span>
          )}
        </div>
      )}

      <div className="kpi-subcriteria-list">
        {area.subCriteria.length === 0 && (
          <p className="empty-state-inline">
            <ListPlus size={14} aria-hidden="true" />
            No sub-criteria yet
          </p>
        )}
        {area.subCriteria.map((sub) =>
          renamingSubCriteriaId === sub.id ? (
            <form key={sub.id} className="inline-form" onSubmit={(e) => onRenameSubCriteria(kpiId, area.id, sub.id, e)}>
              <Input
                name="name"
                defaultValue={sub.name}
                required
                minLength={2}
                aria-label="Sub-criteria name"
                autoFocus
              />
              <Button type="submit" variant="ghost">
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRenamingSubCriteriaId(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div key={sub.id} className="kpi-subcriteria-row hover-actions-row">
              <span>
                <span className="hierarchy-dot" aria-hidden="true" />
                {sub.name}
              </span>
              {canWrite && (
                <span className="hover-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Rename ${sub.name}`}
                    onClick={() => setRenamingSubCriteriaId(sub.id)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </Button>
                  {canManage &&
                    (confirmDeleteSubCriteriaId === sub.id ? (
                      <>
                        <span className="muted">Delete?</span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onDeleteSubCriteria(kpiId, area.id, sub.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => setConfirmDeleteSubCriteriaId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDeleteSubCriteriaId(sub.id)}
                      >
                        Delete
                      </Button>
                    ))}
                </span>
              )}
            </div>
          ),
        )}
        {canWrite &&
          (addingSubCriteriaForAreaId === area.id ? (
            <form className="inline-form" onSubmit={(e) => onCreateSubCriteria(kpiId, area.id, e)}>
              <Input
                name="name"
                required
                minLength={2}
                placeholder="New sub-criteria name"
                aria-label={`New sub-criteria under ${area.name}`}
                autoFocus
              />
              <Button type="submit" variant="ghost">
                Add
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAddingSubCriteriaForAreaId(null)}>
                Close
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => setAddingSubCriteriaForAreaId(area.id)}
            >
              <Plus size={14} aria-hidden="true" />
              Add sub-criteria
            </Button>
          ))}
      </div>
    </div>
  );
}
