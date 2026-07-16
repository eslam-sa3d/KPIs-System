'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, EyeOff, FolderPlus, Layers, ListPlus, Pencil, Plus, Search, Target } from 'lucide-react';
import { toast } from 'sonner';
import { PortalShell, can } from '../../../components/portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError, api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';
import { useResource } from '../../../lib/use-resource';
import { EvaluationAreaCard } from './evaluation-area-card';
import { KpiAssignments } from './kpi-assignments';
import { KpiListPane } from './kpi-list-pane';
import { AssignToField, LoadingRows, StatusPill, WeightRing } from './kpi-widgets';
import type { DepartmentOption, EvaluationAreaRow, KpiAssignmentRow, KpiRow, RoleOption } from './types';

// Evaluation Areas are created with this fixed cadence — the field still
// exists server-side (it drives the Forms→KPI bridge's period calculation)
// but isn't exposed as a user choice on this page.
const DEFAULT_AREA_CADENCE = 'quarterly';

/** Empty string (untouched/cleared input) -> undefined, so JSON.stringify
 *  omits the key entirely rather than sending weight: null or NaN. */
function parseWeight(raw: FormDataEntryValue | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  return Number(raw);
}

export default function KpisAdminPage() {
  const user = useSession();
  const { data: kpis, reload } = useResource<KpiRow[]>(user ? '/v1/kpis?pageSize=100' : null);
  const { data: departmentsData } = useResource<DepartmentOption[]>(user ? '/v1/departments' : null);
  const departments = departmentsData ?? [];
  const { data: rolesData } = useResource<RoleOption[]>(user ? '/v1/roles' : null);
  const roles = rolesData ?? [];
  const [selectedKpiId, setSelectedKpiId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creatingKpi, setCreatingKpi] = useState(false);
  const [renamingKpiId, setRenamingKpiId] = useState<string | null>(null);
  const [confirmDeleteKpiId, setConfirmDeleteKpiId] = useState<string | null>(null);
  /** Set when a plain delete was blocked by existing recorded scores — offers
   *  a distinct, scarier force-delete confirmation instead of leaving the
   *  admin stuck on the "deactivate it instead" error. */
  const [forceDeleteKpiId, setForceDeleteKpiId] = useState<string | null>(null);
  const [renamingAreaId, setRenamingAreaId] = useState<string | null>(null);
  const [confirmDeleteAreaId, setConfirmDeleteAreaId] = useState<string | null>(null);
  const [addingAreaForKpiId, setAddingAreaForKpiId] = useState<string | null>(null);
  const [renamingSubCriteriaId, setRenamingSubCriteriaId] = useState<string | null>(null);
  const [confirmDeleteSubCriteriaId, setConfirmDeleteSubCriteriaId] = useState<string | null>(null);
  const [addingSubCriteriaForAreaId, setAddingSubCriteriaForAreaId] = useState<string | null>(null);
  const [assigningKpiId, setAssigningKpiId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState('');
  const [assigningRoleKpiId, setAssigningRoleKpiId] = useState<string | null>(null);
  const [assignRoleTarget, setAssignRoleTarget] = useState('');
  const [confirmUnassignId, setConfirmUnassignId] = useState<string | null>(null);

  // The selected KPI can disappear out from under the detail pane (deleted,
  // or filtered out by a stale id after a reload) — fall back to the "pick
  // one" empty state rather than pointing at a row that no longer exists.
  useEffect(() => {
    if (selectedKpiId && kpis && !kpis.some((k) => k.id === selectedKpiId)) {
      setSelectedKpiId(null);
    }
  }, [kpis, selectedKpiId]);

  // Success toasts self-dismiss (Sonner's own default timing); errors stay
  // put as an inline alert until the next action so they're not missed mid-read.
  function report(promise: Promise<unknown>, successNote: string) {
    setError(null);
    return promise
      .then(async () => {
        toast.success(successNote);
        await reload();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'The request failed'));
  }

  function onCreateKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assignTo = (form.get('assignTo') as string) || '';
    const created = api<{ id: string }>('/v1/kpis', {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name'), weight: parseWeight(form.get('weight')) }),
    }).then(async (kpi) => {
      if (assignTo) {
        await api(`/v1/kpis/${kpi.id}/assignments`, {
          method: 'POST',
          body: JSON.stringify({ departmentId: assignTo }),
        });
      }
      return kpi;
    });
    // Select only after report()'s own reload() has landed the new KPI in
    // `kpis` — selecting first races the "clear a selection that no longer
    // exists" effect below, which sees the still-stale list and immediately
    // un-selects the KPI that was just created.
    void report(created, assignTo ? 'KPI created and assigned' : 'KPI created').then(() =>
      created.then((kpi) => setSelectedKpiId(kpi.id)).catch(() => undefined),
    );
    (event.target as HTMLFormElement).reset();
  }

  function onRenameKpi(kpiId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void report(
      api(`/v1/kpis/${kpiId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name'), weight: parseWeight(form.get('weight')) }),
      }),
      'KPI renamed',
    ).then(() => setRenamingKpiId(null));
  }

  function onToggleKpiActive(kpi: KpiRow) {
    report(
      api(`/v1/kpis/${kpi.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !kpi.isActive }) }),
      kpi.isActive ? 'KPI deactivated' : 'KPI reactivated',
    );
  }

  function onDeleteKpi(kpiId: string, force = false) {
    const deletion = api(`/v1/kpis/${kpiId}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    void report(deletion, force ? 'KPI permanently deleted, including its recorded scores' : 'KPI deleted').then(() => {
      setConfirmDeleteKpiId(null);
      setForceDeleteKpiId(null);
    });
    // A plain delete blocked by existing scores offers a force-delete escalation
    // instead of just surfacing the error and leaving the admin stuck.
    if (!force) {
      deletion.catch((cause) => {
        if (cause instanceof ApiRequestError && cause.code === 'CONFLICT') {
          setConfirmDeleteKpiId(null);
          setForceDeleteKpiId(kpiId);
        }
      });
    }
  }

  function onAssignKpi(kpiId: string) {
    if (!assignTarget) return;
    void report(
      api(`/v1/kpis/${kpiId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ departmentId: assignTarget }),
      }),
      'KPI assigned',
    ).then(() => setAssignTarget(''));
  }

  function onAssignKpiRole(kpiId: string) {
    if (!assignRoleTarget) return;
    void report(
      api(`/v1/kpis/${kpiId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ roleId: assignRoleTarget }),
      }),
      'KPI assigned',
    ).then(() => setAssignRoleTarget(''));
  }

  function onUnassignKpi(kpiId: string, assignmentId: string) {
    void report(api(`/v1/kpis/${kpiId}/assignments/${assignmentId}`, { method: 'DELETE' }), 'Assignment removed').then(
      () => setConfirmUnassignId(null),
    );
  }

  function assignmentLabel(a: KpiAssignmentRow): string {
    if (a.departmentId) return departments.find((d) => d.id === a.departmentId)?.name ?? 'Unknown department';
    if (a.roleId) return roles.find((r) => r.id === a.roleId)?.name ?? 'Unknown role';
    return a.deliveryStream ?? 'Unknown';
  }

  function onCreateArea(kpiId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void report(
      api(`/v1/kpis/${kpiId}/areas`, {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), cadence: DEFAULT_AREA_CADENCE }),
      }),
      'Evaluation area added',
    );
    (event.target as HTMLFormElement).reset();
  }

  function onRenameArea(kpiId: string, areaId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void report(
      api(`/v1/kpis/${kpiId}/areas/${areaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name') }),
      }),
      'Evaluation area renamed',
    ).then(() => setRenamingAreaId(null));
  }

  function onToggleAreaActive(kpiId: string, area: EvaluationAreaRow) {
    report(
      api(`/v1/kpis/${kpiId}/areas/${area.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !area.isActive }),
      }),
      area.isActive ? 'Area deactivated' : 'Area reactivated',
    );
  }

  function onDeleteArea(kpiId: string, areaId: string) {
    void report(api(`/v1/kpis/${kpiId}/areas/${areaId}`, { method: 'DELETE' }), 'Area deleted').then(() =>
      setConfirmDeleteAreaId(null),
    );
  }

  function onCreateSubCriteria(kpiId: string, areaId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    report(
      api(`/v1/kpis/${kpiId}/areas/${areaId}/sub-criteria`, {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name') }),
      }),
      'Sub-criteria added',
    );
    (event.target as HTMLFormElement).reset();
  }

  function onRenameSubCriteria(
    kpiId: string,
    areaId: string,
    subCriteriaId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void report(
      api(`/v1/kpis/${kpiId}/areas/${areaId}/sub-criteria/${subCriteriaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name') }),
      }),
      'Sub-criteria renamed',
    ).then(() => setRenamingSubCriteriaId(null));
  }

  function onDeleteSubCriteria(kpiId: string, areaId: string, subCriteriaId: string) {
    void report(
      api(`/v1/kpis/${kpiId}/areas/${areaId}/sub-criteria/${subCriteriaId}`, { method: 'DELETE' }),
      'Sub-criteria deleted',
    ).then(() => setConfirmDeleteSubCriteriaId(null));
  }

  const filteredKpis = useMemo(() => {
    if (!kpis) return null;
    const q = search.trim().toLowerCase();
    if (!q) return kpis;
    return kpis.filter((kpi) => kpi.name.toLowerCase().includes(q));
  }, [kpis, search]);

  const stats = useMemo(() => {
    if (!kpis) return null;
    const areas = kpis.flatMap((k) => k.evaluationAreas);
    const subCriteria = areas.flatMap((a) => a.subCriteria);
    const weighted = kpis.filter((k) => k.weight !== null);
    const totalWeight = weighted.reduce((sum, k) => sum + (k.weight ?? 0), 0);
    return {
      kpiCount: kpis.length,
      areaCount: areas.length,
      subCriteriaCount: subCriteria.length,
      totalWeight,
      hasWeights: weighted.length > 0,
      inactiveCount: kpis.filter((k) => !k.isActive).length,
    };
  }, [kpis]);

  const selectedKpi = useMemo(() => kpis?.find((k) => k.id === selectedKpiId) ?? null, [kpis, selectedKpiId]);
  // The KPI's weight isn't stored per area — it's split evenly across
  // however many evaluation areas the KPI currently has, purely for display,
  // so it stays correct automatically as areas are added or removed.
  const areaWeightShare = useMemo(() => {
    if (!selectedKpi || selectedKpi.weight === null || selectedKpi.evaluationAreas.length === 0) return null;
    return Math.round((selectedKpi.weight / selectedKpi.evaluationAreas.length) * 100) / 100;
  }, [selectedKpi]);
  const firstInactiveKpiId = useMemo(() => kpis?.find((k) => !k.isActive)?.id ?? null, [kpis]);
  const canWrite = can(user, 'kpis:edit');
  const canManage = can(user, 'kpis:delete');
  const canToggleStatus = can(user, 'kpis:activate_deactivate');

  return (
    <PortalShell user={user}>
      <h1>KPIs</h1>
      <p className="portal-subtitle">Define KPIs, evaluation areas, and sub-criteria</p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {kpis === null ? (
        <LoadingRows />
      ) : kpis.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Target size={22} aria-hidden="true" />
          </span>
          <h2>No KPIs defined yet</h2>
          <p className="muted">Create your first KPI to start building out evaluation areas.</p>
          {canWrite &&
            (creatingKpi ? (
              <form className="inline-form" onSubmit={(e) => onCreateKpi(e)}>
                <Input
                  name="name"
                  required
                  minLength={2}
                  placeholder="QA Lead Evaluation"
                  aria-label="KPI name"
                  autoFocus
                />
                <Input
                  name="weight"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  placeholder="Weight %"
                  aria-label="Weight percent"
                />
                <AssignToField departments={departments} />
                <Button type="submit">Create</Button>
                <Button type="button" variant="ghost" onClick={() => setCreatingKpi(false)}>
                  Close
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => setCreatingKpi(true)}
              >
                <Plus size={16} aria-hidden="true" />
                New KPI
              </Button>
            ))}
        </div>
      ) : (
        <>
          <div className="insights-row">
            <div className="insight-card tone-purple">
              <span className="hierarchy-icon hierarchy-icon-sm">
                <Target size={15} aria-hidden="true" />
              </span>
              <span className="insight-card-body">
                <strong>{stats!.kpiCount}</strong>
                <span>{stats!.kpiCount === 1 ? 'Kpi' : 'Kpis'}</span>
              </span>
            </div>
            <div className="insight-card tone-green">
              <span className="hierarchy-icon hierarchy-icon-sm">
                <Layers size={15} aria-hidden="true" />
              </span>
              <span className="insight-card-body">
                <strong>{stats!.areaCount}</strong>
                <span>Evaluation areas</span>
              </span>
            </div>
            <div className="insight-card tone-amber">
              <span className="hierarchy-icon hierarchy-icon-sm">
                <ListPlus size={15} aria-hidden="true" />
              </span>
              <span className="insight-card-body">
                <strong>{stats!.subCriteriaCount}</strong>
                <span>Sub-criteria</span>
              </span>
            </div>
            {stats!.hasWeights && (
              <div className={`insight-card${stats!.totalWeight !== 100 ? ' is-warning' : ' tone-blue'}`}>
                <WeightRing value={Math.min(100, stats!.totalWeight)} size="sm" />
                <span className="insight-card-body">
                  <strong>{stats!.totalWeight}%</strong>
                  <span>{stats!.totalWeight === 100 ? 'Weight allocated' : 'Weight — not 100%'}</span>
                </span>
              </div>
            )}
            {stats!.inactiveCount > 0 && (
              <button
                type="button"
                className="insight-card is-alert"
                onClick={() => firstInactiveKpiId && setSelectedKpiId(firstInactiveKpiId)}
              >
                <span className="hierarchy-icon hierarchy-icon-sm">
                  <EyeOff size={15} aria-hidden="true" />
                </span>
                <span className="insight-card-body">
                  <strong>{stats!.inactiveCount}</strong>
                  <span>{stats!.inactiveCount === 1 ? 'Inactive kpi' : 'Inactive kpis'}</span>
                </span>
              </button>
            )}
          </div>

          <div className="kpi-search">
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search KPIs by name…"
              aria-label="Search KPIs"
            />
          </div>

          <div className="kpi-workspace" data-has-selection={selectedKpi ? 'true' : 'false'}>
            <KpiListPane
              canWrite={canWrite}
              creatingKpi={creatingKpi}
              setCreatingKpi={setCreatingKpi}
              onCreateKpi={onCreateKpi}
              departments={departments}
              filteredKpis={filteredKpis}
              search={search}
              selectedKpiId={selectedKpiId}
              setSelectedKpiId={setSelectedKpiId}
            />

            <div className="kpi-detail-pane">
              {!selectedKpi ? (
                <div className="kpi-detail-empty">
                  <Target size={28} aria-hidden="true" />
                  <p>Select a KPI from the list to view its evaluation areas and sub-criteria.</p>
                </div>
              ) : (
                <article>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="kpi-back-to-list"
                    onClick={() => setSelectedKpiId(null)}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    Back to KPIs
                  </Button>

                  {renamingKpiId === selectedKpi.id ? (
                    <form className="inline-form" onSubmit={(e) => onRenameKpi(selectedKpi.id, e)}>
                      <Input
                        name="name"
                        defaultValue={selectedKpi.name}
                        required
                        minLength={2}
                        aria-label="KPI name"
                        autoFocus
                      />
                      <Input
                        name="weight"
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        defaultValue={selectedKpi.weight ?? ''}
                        aria-label={`${selectedKpi.name} weight percent`}
                        placeholder="Weight %"
                      />
                      <Button type="submit" variant="ghost">
                        Save
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setRenamingKpiId(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="kpi-detail-header">
                      <div className="hierarchy-title-row">
                        {selectedKpi.weight !== null ? (
                          <WeightRing value={selectedKpi.weight} />
                        ) : (
                          <span className="hierarchy-icon hierarchy-icon-lg">
                            <Target size={20} aria-hidden="true" />
                          </span>
                        )}
                        <h2>{selectedKpi.name}</h2>
                        {canWrite && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Rename ${selectedKpi.name}`}
                            onClick={() => setRenamingKpiId(selectedKpi.id)}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                      {canWrite && (
                        <span className="row-actions">
                          <StatusPill
                            isActive={selectedKpi.isActive}
                            onToggle={() => onToggleKpiActive(selectedKpi)}
                            disabled={!canToggleStatus}
                          />
                          {canManage &&
                            (confirmDeleteKpiId === selectedKpi.id ? (
                              <>
                                <span className="muted">Delete permanently?</span>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => onDeleteKpi(selectedKpi.id)}
                                >
                                  Confirm delete
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary"
                                  onClick={() => setConfirmDeleteKpiId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : forceDeleteKpiId === selectedKpi.id ? (
                              <>
                                <span className="muted">
                                  This KPI has recorded scores — force deleting destroys that history permanently and
                                  cannot be undone.
                                </span>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => onDeleteKpi(selectedKpi.id, true)}
                                >
                                  Force delete permanently
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary"
                                  onClick={() => setForceDeleteKpiId(null)}
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
                                onClick={() => setConfirmDeleteKpiId(selectedKpi.id)}
                              >
                                Delete
                              </Button>
                            ))}
                        </span>
                      )}
                    </div>
                  )}

                  <KpiAssignments
                    kpiId={selectedKpi.id}
                    assignments={selectedKpi.assignments}
                    departments={departments}
                    roles={roles}
                    canManage={canManage}
                    assignmentLabel={assignmentLabel}
                    confirmUnassignId={confirmUnassignId}
                    setConfirmUnassignId={setConfirmUnassignId}
                    onUnassignKpi={onUnassignKpi}
                    assigningKpiId={assigningKpiId}
                    setAssigningKpiId={setAssigningKpiId}
                    assignTarget={assignTarget}
                    setAssignTarget={setAssignTarget}
                    onAssignKpi={onAssignKpi}
                    assigningRoleKpiId={assigningRoleKpiId}
                    setAssigningRoleKpiId={setAssigningRoleKpiId}
                    assignRoleTarget={assignRoleTarget}
                    setAssignRoleTarget={setAssignRoleTarget}
                    onAssignKpiRole={onAssignKpiRole}
                  />

                  {selectedKpi.evaluationAreas.length === 0 ? (
                    <p className="empty-state-inline">
                      <Layers size={14} aria-hidden="true" />
                      No evaluation areas yet
                    </p>
                  ) : (
                    selectedKpi.evaluationAreas.map((area) => (
                      <EvaluationAreaCard
                        key={area.id}
                        kpiId={selectedKpi.id}
                        area={area}
                        weightShare={areaWeightShare}
                        canWrite={canWrite}
                        canManage={canManage}
                        canToggleStatus={canToggleStatus}
                        renamingAreaId={renamingAreaId}
                        setRenamingAreaId={setRenamingAreaId}
                        confirmDeleteAreaId={confirmDeleteAreaId}
                        setConfirmDeleteAreaId={setConfirmDeleteAreaId}
                        addingSubCriteriaForAreaId={addingSubCriteriaForAreaId}
                        setAddingSubCriteriaForAreaId={setAddingSubCriteriaForAreaId}
                        renamingSubCriteriaId={renamingSubCriteriaId}
                        setRenamingSubCriteriaId={setRenamingSubCriteriaId}
                        confirmDeleteSubCriteriaId={confirmDeleteSubCriteriaId}
                        setConfirmDeleteSubCriteriaId={setConfirmDeleteSubCriteriaId}
                        onRenameArea={onRenameArea}
                        onToggleAreaActive={onToggleAreaActive}
                        onDeleteArea={onDeleteArea}
                        onCreateSubCriteria={onCreateSubCriteria}
                        onRenameSubCriteria={onRenameSubCriteria}
                        onDeleteSubCriteria={onDeleteSubCriteria}
                      />
                    ))
                  )}

                  {canWrite &&
                    (addingAreaForKpiId === selectedKpi.id ? (
                      <form className="inline-form" onSubmit={(e) => onCreateArea(selectedKpi.id, e)}>
                        <Input
                          name="name"
                          required
                          minLength={2}
                          placeholder="New area name"
                          aria-label="New area name"
                          autoFocus
                        />
                        <Button type="submit" variant="ghost">
                          Add
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setAddingAreaForKpiId(null)}>
                          Close
                        </Button>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
                        onClick={() => setAddingAreaForKpiId(selectedKpi.id)}
                      >
                        <FolderPlus size={16} aria-hidden="true" />
                        Add evaluation area
                      </Button>
                    ))}
                </article>
              )}
            </div>
          </div>
        </>
      )}
    </PortalShell>
  );
}
