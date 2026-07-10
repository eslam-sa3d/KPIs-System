'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, EyeOff, FolderPlus, Layers, ListPlus, Pencil, Plus, Search, Target } from 'lucide-react';
import { toast } from 'sonner';
import { PortalShell, can } from '../../../components/portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface SubCriteriaRow {
  id: string;
  name: string;
}

interface EvaluationAreaRow {
  id: string;
  name: string;
  cadence: string;
  isActive: boolean;
  subCriteria: SubCriteriaRow[];
}

interface KpiAssignmentRow {
  id: string;
  roleId: string | null;
  departmentId: string | null;
  deliveryStream: string | null;
}

interface KpiRow {
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

interface RoleOption {
  id: string;
  name: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

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

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** M3-style conic-gradient dial showing a 0-100 weight at a glance instead
 *  of burying it in a run of muted text. */
function WeightRing({ value, size = 'md' }: { value: number; size?: 'md' | 'sm' }) {
  return (
    <span
      className={`weight-ring${size === 'sm' ? ' weight-ring-sm' : ''}`}
      style={{ '--ring-pct': `${Math.min(100, Math.max(0, value))}%` } as React.CSSProperties}
      role="img"
      aria-label={`weight ${value}%`}
    >
      <span className="weight-ring-value" aria-hidden="true">
        {value}
      </span>
    </span>
  );
}

/** Toggles isActive via the same PATCH every level already uses — styled as
 *  a status pill (dot + label) instead of a text button whose label is
 *  always the opposite of the current state ("deactivate" while active). */
function StatusPill({
  isActive,
  onToggle,
  size,
}: {
  isActive: boolean;
  onToggle: () => void;
  size?: 'sm';
}) {
  return (
    <Badge
      asChild
      variant="outline"
      className={size === 'sm' ? 'gap-1.5 py-0.5 text-xs' : 'gap-1.5 py-1'}
    >
      <button type="button" onClick={onToggle} className={isActive ? '' : 'text-muted-foreground'}>
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: isActive ? 'var(--color-success)' : 'var(--color-text-muted)' }}
          aria-hidden="true"
        />
        {isActive ? 'active' : 'inactive'}
      </button>
    </Badge>
  );
}

function SkeletonRows() {
  return (
    <div className="rounded-md border bg-card mt-4 mb-6 p-6 space-y-3" aria-hidden="true">
      <Skeleton className="h-3.5" style={{ width: '70%' }} />
      <Skeleton className="h-3.5" style={{ width: '50%' }} />
      <Skeleton className="h-3.5" style={{ width: '65%' }} />
      <Skeleton className="h-3.5" style={{ width: '40%' }} />
    </div>
  );
}

export default function KpisAdminPage() {
  const user = useSession();
  const [kpis, setKpis] = useState<KpiRow[] | null>(null);
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
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [assigningKpiId, setAssigningKpiId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState('');
  const [confirmUnassignId, setConfirmUnassignId] = useState<string | null>(null);

  const reload = useCallback(() => api<KpiRow[]>('/v1/kpis?pageSize=100').then(setKpis), []);

  useEffect(() => {
    if (!user) return;
    void reload();
    api<RoleOption[]>('/v1/roles').then(setRoles).catch(() => setRoles([]));
    api<DepartmentOption[]>('/v1/departments').then(setDepartments).catch(() => setDepartments([]));
  }, [user, reload]);

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
        const [kind, id] = assignTo.split(':') as ['role' | 'dept', string];
        await api(`/v1/kpis/${kpi.id}/assignments`, {
          method: 'POST',
          body: JSON.stringify(kind === 'role' ? { roleId: id } : { departmentId: id }),
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

  /** Shared "visible to" picker for the KPI-creation forms — folds the
   *  default role/department assignment into creation itself, instead of
   *  leaving a brand-new KPI invisible on every dashboard until an admin
   *  makes a separate follow-up trip to the assignment UI below. */
  function AssignToField() {
    return (
      <select name="assignTo" aria-label="visible to (optional)" defaultValue="">
        <option value="">visible to (optional)…</option>
        {roles.length > 0 && (
          <optgroup label="roles">
            {roles.map((r) => (
              <option key={r.id} value={`role:${r.id}`}>
                {r.name}
              </option>
            ))}
          </optgroup>
        )}
        {departments.length > 0 && (
          <optgroup label="departments">
            {departments.map((d) => (
              <option key={d.id} value={`dept:${d.id}`}>
                {d.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
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
      api(`/v1/kpis/${kpi.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !kpi.isActive }) }),
      kpi.isActive ? 'KPI deactivated' : 'KPI reactivated',
    );
  }

  function onDeleteKpi(kpiId: string, force = false) {
    const deletion = api(`/v1/kpis/${kpiId}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    void report(deletion, force ? 'KPI permanently deleted, including its recorded scores' : 'KPI deleted').then(
      () => {
        setConfirmDeleteKpiId(null);
        setForceDeleteKpiId(null);
      },
    );
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
    const [kind, id] = assignTarget.split(':') as ['role' | 'dept', string];
    void report(
      api(`/v1/kpis/${kpiId}/assignments`, {
        method: 'POST',
        body: JSON.stringify(kind === 'role' ? { roleId: id } : { departmentId: id }),
      }),
      'KPI assigned',
    ).then(() => setAssignTarget(''));
  }

  function onUnassignKpi(kpiId: string, assignmentId: string) {
    void report(api(`/v1/kpis/${kpiId}/assignments/${assignmentId}`, { method: 'DELETE' }), 'assignment removed').then(
      () => setConfirmUnassignId(null),
    );
  }

  function assignmentLabel(a: KpiAssignmentRow): string {
    if (a.roleId) return roles.find((r) => r.id === a.roleId)?.name ?? 'unknown role';
    if (a.departmentId) return departments.find((d) => d.id === a.departmentId)?.name ?? 'unknown department';
    return a.deliveryStream ?? 'unknown';
  }

  function onCreateArea(kpiId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void report(
      api(`/v1/kpis/${kpiId}/areas`, {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), cadence: DEFAULT_AREA_CADENCE }),
      }),
      'evaluation area added',
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
      'evaluation area renamed',
    ).then(() => setRenamingAreaId(null));
  }

  function onToggleAreaActive(kpiId: string, area: EvaluationAreaRow) {
    report(
      api(`/v1/kpis/${kpiId}/areas/${area.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !area.isActive }),
      }),
      area.isActive ? 'area deactivated' : 'area reactivated',
    );
  }

  function onDeleteArea(kpiId: string, areaId: string) {
    void report(api(`/v1/kpis/${kpiId}/areas/${areaId}`, { method: 'DELETE' }), 'area deleted').then(() =>
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
      'sub-criteria added',
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
      'sub-criteria renamed',
    ).then(() => setRenamingSubCriteriaId(null));
  }

  function onDeleteSubCriteria(kpiId: string, areaId: string, subCriteriaId: string) {
    void report(
      api(`/v1/kpis/${kpiId}/areas/${areaId}/sub-criteria/${subCriteriaId}`, { method: 'DELETE' }),
      'sub-criteria deleted',
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
  const firstInactiveKpiId = useMemo(() => kpis?.find((k) => !k.isActive)?.id ?? null, [kpis]);
  const canWrite = can(user, 'kpis:write');
  const canManage = can(user, 'kpis:manage');

  return (
    <PortalShell user={user}>
      <h1>KPIs</h1>
      <p className="portal-subtitle">define KPIs, evaluation areas, and sub-criteria</p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {kpis === null ? (
        <SkeletonRows />
      ) : kpis.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Target size={22} aria-hidden="true" />
          </span>
          <h2>no KPIs defined yet</h2>
          <p className="muted">create your first KPI to start building out evaluation areas.</p>
          {canWrite &&
            (creatingKpi ? (
              <form className="inline-form" onSubmit={(e) => onCreateKpi(e)}>
                <input name="name" required minLength={2} placeholder="QA Lead Evaluation" aria-label="KPI name" autoFocus />
                <input name="weight" type="number" min={0} max={100} step="0.5" placeholder="weight %" aria-label="weight percent" />
                <AssignToField />
                <Button type="submit">create</Button>
                <Button type="button" variant="ghost" onClick={() => setCreatingKpi(false)}>
                  close
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                onClick={() => setCreatingKpi(true)}
              >
                <Plus size={16} aria-hidden="true" />
                new KPI
              </Button>
            ))}
        </div>
      ) : (
        <>
          <div className="insights-row">
            <div className="insight-card">
              <span className="hierarchy-icon hierarchy-icon-sm">
                <Target size={15} aria-hidden="true" />
              </span>
              <span className="insight-card-body">
                <strong>{stats!.kpiCount}</strong>
                <span>{stats!.kpiCount === 1 ? 'kpi' : 'kpis'}</span>
              </span>
            </div>
            <div className="insight-card">
              <span className="hierarchy-icon hierarchy-icon-sm">
                <Layers size={15} aria-hidden="true" />
              </span>
              <span className="insight-card-body">
                <strong>{stats!.areaCount}</strong>
                <span>evaluation areas</span>
              </span>
            </div>
            <div className="insight-card">
              <span className="hierarchy-icon hierarchy-icon-sm">
                <ListPlus size={15} aria-hidden="true" />
              </span>
              <span className="insight-card-body">
                <strong>{stats!.subCriteriaCount}</strong>
                <span>sub-criteria</span>
              </span>
            </div>
            {stats!.hasWeights && (
              <div className={`insight-card${stats!.totalWeight !== 100 ? ' is-warning' : ''}`}>
                <WeightRing value={Math.min(100, stats!.totalWeight)} size="sm" />
                <span className="insight-card-body">
                  <strong>{stats!.totalWeight}%</strong>
                  <span>{stats!.totalWeight === 100 ? 'weight allocated' : 'weight — not 100%'}</span>
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
                  <span>{stats!.inactiveCount === 1 ? 'inactive kpi' : 'inactive kpis'}</span>
                </span>
              </button>
            )}
          </div>

          <div className="kpi-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search KPIs by name…"
              aria-label="search KPIs"
            />
          </div>

          <div className="kpi-workspace" data-has-selection={selectedKpi ? 'true' : 'false'}>
            <div className="kpi-list-pane">
              {canWrite &&
                (creatingKpi ? (
                  <form className="inline-form" onSubmit={(e) => onCreateKpi(e)}>
                    <input name="name" required minLength={2} placeholder="new KPI name" aria-label="KPI name" autoFocus />
                    <input name="weight" type="number" min={0} max={100} step="0.5" placeholder="weight %" aria-label="weight percent" />
                    <AssignToField />
                    <Button type="submit">create</Button>
                    <Button type="button" variant="ghost" onClick={() => setCreatingKpi(false)}>
                      close
                    </Button>
                  </form>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                    onClick={() => setCreatingKpi(true)}
                  >
                    <Plus size={16} aria-hidden="true" />
                    new KPI
                  </Button>
                ))}

              {filteredKpis && filteredKpis.length === 0 ? (
                <p className="empty-state-inline">
                  <Search size={14} aria-hidden="true" />
                  no KPIs match &quot;{search}&quot;
                </p>
              ) : (
                <div className="kpi-list-items">
                  {filteredKpis?.map((kpi) => (
                    <button
                      key={kpi.id}
                      type="button"
                      className={`kpi-list-item${selectedKpiId === kpi.id ? ' is-selected' : ''}`}
                      aria-current={selectedKpiId === kpi.id ? 'true' : undefined}
                      onClick={() => setSelectedKpiId(kpi.id)}
                    >
                      {kpi.weight !== null ? (
                        <WeightRing value={kpi.weight} size="sm" />
                      ) : (
                        <span className="hierarchy-icon hierarchy-icon-sm">
                          <Target size={14} aria-hidden="true" />
                        </span>
                      )}
                      <span className="kpi-list-item-body">
                        <span className="kpi-list-item-name">{kpi.name}</span>
                        <span className="kpi-list-item-meta">
                          {!kpi.isActive && (
                            <span
                              className="size-[7px] shrink-0 rounded-full"
                              style={{ background: 'var(--color-text-muted)' }}
                              aria-hidden="true"
                            />
                          )}
                          {pluralize(kpi.evaluationAreas.length, 'area')}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="kpi-detail-pane">
              {!selectedKpi ? (
                <div className="kpi-detail-empty">
                  <Target size={28} aria-hidden="true" />
                  <p>select a KPI from the list to view its evaluation areas and sub-criteria.</p>
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
                    back to KPIs
                  </Button>

                  {renamingKpiId === selectedKpi.id ? (
                    <form className="inline-form" onSubmit={(e) => onRenameKpi(selectedKpi.id, e)}>
                      <input name="name" defaultValue={selectedKpi.name} required minLength={2} aria-label="KPI name" autoFocus />
                      <input
                        name="weight"
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        defaultValue={selectedKpi.weight ?? ''}
                        aria-label={`${selectedKpi.name} weight percent`}
                        placeholder="weight %"
                      />
                      <Button type="submit" variant="ghost">
                        save
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setRenamingKpiId(null)}>
                        cancel
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
                            aria-label={`rename ${selectedKpi.name}`}
                            onClick={() => setRenamingKpiId(selectedKpi.id)}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                      {canWrite && (
                        <span className="row-actions">
                          <StatusPill isActive={selectedKpi.isActive} onToggle={() => onToggleKpiActive(selectedKpi)} />
                          {canManage &&
                            (confirmDeleteKpiId === selectedKpi.id ? (
                              <>
                                <span className="muted">delete permanently?</span>
                                <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteKpi(selectedKpi.id)}>
                                  confirm delete
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary"
                                  onClick={() => setConfirmDeleteKpiId(null)}
                                >
                                  cancel
                                </Button>
                              </>
                            ) : forceDeleteKpiId === selectedKpi.id ? (
                              <>
                                <span className="muted">
                                  this KPI has recorded scores — force deleting destroys that history
                                  permanently and cannot be undone.
                                </span>
                                <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteKpi(selectedKpi.id, true)}>
                                  force delete permanently
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary hover:text-primary"
                                  onClick={() => setForceDeleteKpiId(null)}
                                >
                                  cancel
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
                                delete
                              </Button>
                            ))}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="kpi-assignments">
                    <label>visible to</label>
                    {selectedKpi.assignments.length === 0 ? (
                      <p className="empty-state-inline">
                        <EyeOff size={14} aria-hidden="true" />
                        not assigned to any role or department — only visible here on the admin page
                      </p>
                    ) : (
                      <span className="row-actions">
                        {selectedKpi.assignments.map((a) => (
                          <Badge key={a.id} variant="outline" className="gap-1.5 py-0.5 text-xs">
                            {assignmentLabel(a)}
                            {canManage &&
                              (confirmUnassignId === a.id ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="confirm remove"
                                    onClick={() => onUnassignKpi(selectedKpi.id, a.id)}
                                  >
                                    ✓
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="cancel remove"
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
                                  aria-label={`remove ${assignmentLabel(a)} assignment`}
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
                      (assigningKpiId === selectedKpi.id ? (
                        <span className="inline-form">
                          <select
                            aria-label="assign to"
                            value={assignTarget}
                            onChange={(e) => setAssignTarget(e.target.value)}
                          >
                            <option value="">choose a role or department…</option>
                            {roles.length > 0 && (
                              <optgroup label="roles">
                                {roles.map((r) => (
                                  <option key={r.id} value={`role:${r.id}`}>
                                    {r.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {departments.length > 0 && (
                              <optgroup label="departments">
                                {departments.map((d) => (
                                  <option key={d.id} value={`dept:${d.id}`}>
                                    {d.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!assignTarget}
                            onClick={() => onAssignKpi(selectedKpi.id)}
                          >
                            assign
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setAssigningKpiId(null);
                              setAssignTarget('');
                            }}
                          >
                            close
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                          onClick={() => setAssigningKpiId(selectedKpi.id)}
                        >
                          <Plus size={14} aria-hidden="true" />
                          assign to role or department
                        </Button>
                      ))}
                  </div>

                  {selectedKpi.evaluationAreas.length === 0 ? (
                    <p className="empty-state-inline">
                      <Layers size={14} aria-hidden="true" />
                      no evaluation areas yet
                    </p>
                  ) : (
                    selectedKpi.evaluationAreas.map((area) => (
                      <div key={area.id} className="builder-field kpi-area">
                        {renamingAreaId === area.id ? (
                          <form className="inline-form" onSubmit={(e) => onRenameArea(selectedKpi.id, area.id, e)}>
                            <input name="name" defaultValue={area.name} required minLength={2} aria-label="evaluation area name" autoFocus />
                            <Button type="submit" variant="ghost">
                              save
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setRenamingAreaId(null)}>
                              cancel
                            </Button>
                          </form>
                        ) : (
                          <div className="kpi-area-head hover-actions-row">
                            <div className="hierarchy-title-row">
                              <span className="hierarchy-icon hierarchy-icon-sm">
                                <Layers size={15} aria-hidden="true" />
                              </span>
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
                                  aria-label={`rename ${area.name}`}
                                  onClick={() => setRenamingAreaId(area.id)}
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                </Button>
                                <StatusPill
                                  isActive={area.isActive}
                                  onToggle={() => onToggleAreaActive(selectedKpi.id, area)}
                                  size="sm"
                                />
                                {canManage &&
                                  (confirmDeleteAreaId === area.id ? (
                                    <>
                                      <span className="muted">delete permanently?</span>
                                      <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteArea(selectedKpi.id, area.id)}>
                                        confirm delete
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-primary hover:text-primary"
                                        onClick={() => setConfirmDeleteAreaId(null)}
                                      >
                                        cancel
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
                                      delete
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
                              no sub-criteria yet
                            </p>
                          )}
                          {area.subCriteria.map((sub) =>
                            renamingSubCriteriaId === sub.id ? (
                              <form
                                key={sub.id}
                                className="inline-form"
                                onSubmit={(e) => onRenameSubCriteria(selectedKpi.id, area.id, sub.id, e)}
                              >
                                <input name="name" defaultValue={sub.name} required minLength={2} aria-label="sub-criteria name" autoFocus />
                                <Button type="submit" variant="ghost">
                                  save
                                </Button>
                                <Button type="button" variant="ghost" onClick={() => setRenamingSubCriteriaId(null)}>
                                  cancel
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
                                      aria-label={`rename ${sub.name}`}
                                      onClick={() => setRenamingSubCriteriaId(sub.id)}
                                    >
                                      <Pencil size={13} aria-hidden="true" />
                                    </Button>
                                    {canManage &&
                                      (confirmDeleteSubCriteriaId === sub.id ? (
                                        <>
                                          <span className="muted">delete?</span>
                                          <Button
                                            type="button"
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => onDeleteSubCriteria(selectedKpi.id, area.id, sub.id)}
                                          >
                                            confirm
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="text-primary hover:text-primary"
                                            onClick={() => setConfirmDeleteSubCriteriaId(null)}
                                          >
                                            cancel
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
                                          delete
                                        </Button>
                                      ))}
                                  </span>
                                )}
                              </div>
                            ),
                          )}
                          {canWrite &&
                            (addingSubCriteriaForAreaId === area.id ? (
                              <form className="inline-form" onSubmit={(e) => onCreateSubCriteria(selectedKpi.id, area.id, e)}>
                                <input
                                  name="name"
                                  required
                                  minLength={2}
                                  placeholder="new sub-criteria name"
                                  aria-label={`new sub-criteria under ${area.name}`}
                                  autoFocus
                                />
                                <Button type="submit" variant="ghost">
                                  add
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => setAddingSubCriteriaForAreaId(null)}
                                >
                                  close
                                </Button>
                              </form>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                                onClick={() => setAddingSubCriteriaForAreaId(area.id)}
                              >
                                <Plus size={14} aria-hidden="true" />
                                add sub-criteria
                              </Button>
                            ))}
                        </div>
                      </div>
                    ))
                  )}

                  {canWrite &&
                    (addingAreaForKpiId === selectedKpi.id ? (
                      <form className="inline-form" onSubmit={(e) => onCreateArea(selectedKpi.id, e)}>
                        <input name="name" required minLength={2} placeholder="new area name" aria-label="new area name" autoFocus />
                        <Button type="submit" variant="ghost">
                          add
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setAddingAreaForKpiId(null)}>
                          close
                        </Button>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
                        onClick={() => setAddingAreaForKpiId(selectedKpi.id)}
                      >
                        <FolderPlus size={16} aria-hidden="true" />
                        add evaluation area
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
