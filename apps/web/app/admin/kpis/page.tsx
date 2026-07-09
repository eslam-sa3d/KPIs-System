'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, FolderPlus, Layers, ListPlus, Plus, Search, Target } from 'lucide-react';
import { PortalShell, can } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
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

interface KpiRow {
  id: string;
  name: string;
  /** Relative importance as a percentage (0-100) — informational only. */
  weight: number | null;
  isActive: boolean;
  evaluationAreas: EvaluationAreaRow[];
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
function WeightRing({ value }: { value: number }) {
  return (
    <span
      className="weight-ring"
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

function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-line" style={{ width: '40%' }} />
      <div className="skeleton-line" style={{ width: '25%' }} />
      <div className="skeleton-line" style={{ width: '60%' }} />
    </div>
  );
}

export default function KpisAdminPage() {
  const user = useSession();
  const [kpis, setKpis] = useState<KpiRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingKpi, setCreatingKpi] = useState(false);
  const [renamingKpiId, setRenamingKpiId] = useState<string | null>(null);
  const [confirmDeleteKpiId, setConfirmDeleteKpiId] = useState<string | null>(null);
  const [renamingAreaId, setRenamingAreaId] = useState<string | null>(null);
  const [confirmDeleteAreaId, setConfirmDeleteAreaId] = useState<string | null>(null);
  const [addingAreaForKpiId, setAddingAreaForKpiId] = useState<string | null>(null);
  const [renamingSubCriteriaId, setRenamingSubCriteriaId] = useState<string | null>(null);
  const [confirmDeleteSubCriteriaId, setConfirmDeleteSubCriteriaId] = useState<string | null>(null);
  const [addingSubCriteriaForAreaId, setAddingSubCriteriaForAreaId] = useState<string | null>(null);
  const [expandedKpiIds, setExpandedKpiIds] = useState<Set<string>>(new Set());
  const [expandedAreaIds, setExpandedAreaIds] = useState<Set<string>>(new Set());

  function toggleKpi(id: string) {
    setExpandedKpiIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleArea(id: string) {
    setExpandedAreaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const reload = useCallback(() => api<KpiRow[]>('/v1/kpis?pageSize=100').then(setKpis), []);

  useEffect(() => {
    if (!user) return;
    void reload();
  }, [user, reload]);

  function report(promise: Promise<unknown>, successNote: string) {
    setError(null);
    setNotice(null);
    return promise
      .then(async () => {
        setNotice(successNote);
        await reload();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'The request failed'));
  }

  function onCreateKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = api<{ id: string }>('/v1/kpis', {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name'), weight: parseWeight(form.get('weight')) }),
    });
    report(created, 'KPI created');
    created.then((kpi) => setExpandedKpiIds((prev) => new Set(prev).add(kpi.id))).catch(() => undefined);
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
      api(`/v1/kpis/${kpi.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !kpi.isActive }) }),
      kpi.isActive ? 'KPI deactivated' : 'KPI reactivated',
    );
  }

  function onDeleteKpi(kpiId: string) {
    void report(api(`/v1/kpis/${kpiId}`, { method: 'DELETE' }), 'KPI deleted').then(() =>
      setConfirmDeleteKpiId(null),
    );
  }

  function onCreateArea(kpiId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = api<{ id: string }>(`/v1/kpis/${kpiId}/areas`, {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name'), cadence: DEFAULT_AREA_CADENCE }),
    });
    report(created, 'evaluation area added');
    created.then((area) => setExpandedAreaIds((prev) => new Set(prev).add(area.id))).catch(() => undefined);
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
    };
  }, [kpis]);

  return (
    <PortalShell user={user}>
      <h1>KPIs</h1>
      <p className="portal-subtitle">define KPIs, evaluation areas, and sub-criteria</p>

      {notice && <p className="form-notice">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {stats && stats.kpiCount > 0 && (
        <div className="kpi-page-stats">
          <div className="kpi-stat-chip">
            <strong>{stats.kpiCount}</strong>
            <span>{pluralize(stats.kpiCount, 'kpi').replace(/^\d+\s/, '')}</span>
          </div>
          <div className="kpi-stat-chip">
            <strong>{stats.areaCount}</strong>
            <span>evaluation areas</span>
          </div>
          <div className="kpi-stat-chip">
            <strong>{stats.subCriteriaCount}</strong>
            <span>sub-criteria</span>
          </div>
          {stats.hasWeights && (
            <div className={`kpi-stat-chip${stats.totalWeight !== 100 ? ' kpi-stat-warning' : ''}`}>
              <strong>{stats.totalWeight}%</strong>
              <span>{stats.totalWeight === 100 ? 'weight allocated' : 'weight — not 100%'}</span>
            </div>
          )}
        </div>
      )}

      {can(user, 'kpis:write') &&
        (creatingKpi ? (
          <form className="builder admin-card" onSubmit={(e) => onCreateKpi(e)}>
            <h2>new KPI</h2>
            <label htmlFor="k-name">name</label>
            <input id="k-name" name="name" required minLength={2} placeholder="QA Lead Evaluation" autoFocus />
            <label htmlFor="k-weight">weight %</label>
            <input id="k-weight" name="weight" type="number" min={0} max={100} step="0.5" placeholder="e.g. 25" />
            <div className="page-title-row" style={{ marginTop: 'var(--space-2)' }}>
              <button className="btn-primary" type="submit">
                create KPI
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCreatingKpi(false)}>
                close
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="add-trigger" onClick={() => setCreatingKpi(true)}>
            <Plus size={16} aria-hidden="true" />
            new KPI
          </button>
        ))}

      {kpis && kpis.length > 0 && (
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
      )}

      {kpis === null ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : kpis.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Target size={22} aria-hidden="true" />
          </span>
          <h2>no KPIs defined yet</h2>
          <p className="muted">create your first KPI above to start building out evaluation areas.</p>
        </div>
      ) : filteredKpis && filteredKpis.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Search size={22} aria-hidden="true" />
          </span>
          <h2>no KPIs match &quot;{search}&quot;</h2>
        </div>
      ) : (
        filteredKpis?.map((kpi) => (
          <article key={kpi.id} className="admin-card">
            {renamingKpiId === kpi.id ? (
              <form className="inline-form" onSubmit={(e) => onRenameKpi(kpi.id, e)}>
                <input name="name" defaultValue={kpi.name} required minLength={2} aria-label="KPI name" />
                <input
                  name="weight"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  defaultValue={kpi.weight ?? ''}
                  aria-label={`${kpi.name} weight percent`}
                  placeholder="weight %"
                />
                <button className="btn-ghost" type="submit">
                  save
                </button>
                <button type="button" className="btn-ghost" onClick={() => setRenamingKpiId(null)}>
                  cancel
                </button>
              </form>
            ) : (
              <div className="page-title-row">
                <button
                  type="button"
                  className="hierarchy-title-row accordion-toggle"
                  aria-expanded={expandedKpiIds.has(kpi.id)}
                  aria-controls={`kpi-body-${kpi.id}`}
                  onClick={() => toggleKpi(kpi.id)}
                >
                  {kpi.weight !== null ? (
                    <WeightRing value={kpi.weight} />
                  ) : (
                    <span className="hierarchy-icon hierarchy-icon-lg">
                      <Target size={20} aria-hidden="true" />
                    </span>
                  )}
                  <strong className="hierarchy-kpi-name">
                    {kpi.name} {!kpi.isActive && <span className="muted">(inactive)</span>}
                  </strong>
                  <ChevronRight
                    size={18}
                    className={`accordion-chevron${expandedKpiIds.has(kpi.id) ? ' is-open' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {can(user, 'kpis:write') && (
                  <span className="row-actions">
                    <button type="button" className="btn-text" onClick={() => setRenamingKpiId(kpi.id)}>
                      rename
                    </button>
                    <button type="button" className="btn-text" onClick={() => onToggleKpiActive(kpi)}>
                      {kpi.isActive ? 'deactivate' : 'reactivate'}
                    </button>
                    {can(user, 'kpis:manage') &&
                      (confirmDeleteKpiId === kpi.id ? (
                        <>
                          <span className="muted">delete permanently?</span>
                          <button type="button" className="btn-text btn-text-danger" onClick={() => onDeleteKpi(kpi.id)}>
                            confirm delete
                          </button>
                          <button type="button" className="btn-text" onClick={() => setConfirmDeleteKpiId(null)}>
                            cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn-text btn-text-danger"
                          onClick={() => setConfirmDeleteKpiId(kpi.id)}
                        >
                          delete
                        </button>
                      ))}
                  </span>
                )}
              </div>
            )}
            <p className="muted">{pluralize(kpi.evaluationAreas.length, 'evaluation area')}</p>

            {expandedKpiIds.has(kpi.id) && (
              <div id={`kpi-body-${kpi.id}`}>
                <label>evaluation areas</label>
                {kpi.evaluationAreas.length === 0 ? (
                  <p className="empty-state-inline">
                    <Layers size={14} aria-hidden="true" />
                    no evaluation areas yet
                  </p>
                ) : (
                  kpi.evaluationAreas.map((area) => (
                    <div key={area.id} className="builder-field kpi-area">
                      {renamingAreaId === area.id ? (
                        <form className="inline-form" onSubmit={(e) => onRenameArea(kpi.id, area.id, e)}>
                          <input name="name" defaultValue={area.name} required minLength={2} aria-label="evaluation area name" />
                          <button className="btn-ghost" type="submit">
                            save
                          </button>
                          <button type="button" className="btn-ghost" onClick={() => setRenamingAreaId(null)}>
                            cancel
                          </button>
                        </form>
                      ) : (
                        <div className="hierarchy-row">
                          <button
                            type="button"
                            className="hierarchy-title-row accordion-toggle"
                            aria-expanded={expandedAreaIds.has(area.id)}
                            aria-controls={`area-body-${area.id}`}
                            onClick={() => toggleArea(area.id)}
                          >
                            <span className="hierarchy-icon hierarchy-icon-sm">
                              <Layers size={15} aria-hidden="true" />
                            </span>
                            <strong>
                              {area.name}
                              {!area.isActive && <span className="muted"> (inactive)</span>}
                              {area.subCriteria.length > 0 && (
                                <span className="muted"> · {pluralize(area.subCriteria.length, 'sub-criteria', 'sub-criteria')}</span>
                              )}
                            </strong>
                            <ChevronRight
                              size={16}
                              className={`accordion-chevron${expandedAreaIds.has(area.id) ? ' is-open' : ''}`}
                              aria-hidden="true"
                            />
                          </button>
                          {can(user, 'kpis:write') && (
                            <span className="row-actions">
                              <button type="button" className="btn-text" onClick={() => setRenamingAreaId(area.id)}>
                                rename
                              </button>
                              <button type="button" className="btn-text" onClick={() => onToggleAreaActive(kpi.id, area)}>
                                {area.isActive ? 'deactivate' : 'reactivate'}
                              </button>
                              {can(user, 'kpis:manage') &&
                                (confirmDeleteAreaId === area.id ? (
                                  <>
                                    <span className="muted">delete permanently?</span>
                                    <button
                                      type="button"
                                      className="btn-text btn-text-danger"
                                      onClick={() => onDeleteArea(kpi.id, area.id)}
                                    >
                                      confirm delete
                                    </button>
                                    <button type="button" className="btn-text" onClick={() => setConfirmDeleteAreaId(null)}>
                                      cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-text btn-text-danger"
                                    onClick={() => setConfirmDeleteAreaId(area.id)}
                                  >
                                    delete
                                  </button>
                                ))}
                            </span>
                          )}
                        </div>
                      )}

                      {expandedAreaIds.has(area.id) && (
                        <div id={`area-body-${area.id}`}>
                          <label>sub-criteria</label>
                          {area.subCriteria.length === 0 ? (
                            <p className="empty-state-inline">
                              <ListPlus size={14} aria-hidden="true" />
                              no sub-criteria yet
                            </p>
                          ) : (
                                    area.subCriteria.map((sub) => (
                              <div key={sub.id} className="hierarchy-row hierarchy-row-child">
                                {renamingSubCriteriaId === sub.id ? (
                                  <form
                                    className="inline-form"
                                    onSubmit={(e) => onRenameSubCriteria(kpi.id, area.id, sub.id, e)}
                                  >
                                    <input name="name" defaultValue={sub.name} required minLength={2} aria-label="sub-criteria name" />
                                    <button className="btn-ghost" type="submit">
                                      save
                                    </button>
                                    <button type="button" className="btn-ghost" onClick={() => setRenamingSubCriteriaId(null)}>
                                      cancel
                                    </button>
                                  </form>
                                ) : (
                                  <span>
                                    <span className="hierarchy-dot" aria-hidden="true" />
                                    {sub.name}
                                  </span>
                                )}
                                {can(user, 'kpis:write') && renamingSubCriteriaId !== sub.id && (
                                  <span className="row-actions">
                                    <button
                                      type="button"
                                      className="btn-text"
                                      onClick={() => setRenamingSubCriteriaId(sub.id)}
                                    >
                                      rename
                                    </button>
                                    {can(user, 'kpis:manage') &&
                                      (confirmDeleteSubCriteriaId === sub.id ? (
                                        <>
                                          <span className="muted">delete permanently?</span>
                                          <button
                                            type="button"
                                            className="btn-text btn-text-danger"
                                            onClick={() => onDeleteSubCriteria(kpi.id, area.id, sub.id)}
                                          >
                                            confirm delete
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-text"
                                            onClick={() => setConfirmDeleteSubCriteriaId(null)}
                                          >
                                            cancel
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn-text btn-text-danger"
                                          onClick={() => setConfirmDeleteSubCriteriaId(sub.id)}
                                        >
                                          delete
                                        </button>
                                      ))}
                                  </span>
                                )}
                              </div>
                            ))
                          )}
                          {can(user, 'kpis:write') &&
                            (addingSubCriteriaForAreaId === area.id ? (
                              <form className="inline-form" onSubmit={(e) => onCreateSubCriteria(kpi.id, area.id, e)}>
                                <input
                                  name="name"
                                  required
                                  minLength={2}
                                  placeholder="new sub-criteria name"
                                  aria-label={`new sub-criteria under ${area.name}`}
                                  autoFocus
                                />
                                <button className="btn-ghost" type="submit">
                                  add
                                </button>
                                <button type="button" className="btn-ghost" onClick={() => setAddingSubCriteriaForAreaId(null)}>
                                  close
                                </button>
                              </form>
                            ) : (
                              <button type="button" className="add-trigger" onClick={() => setAddingSubCriteriaForAreaId(area.id)}>
                                <Plus size={14} aria-hidden="true" />
                                add sub-criteria
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ))
                )}

                {can(user, 'kpis:write') &&
                  (addingAreaForKpiId === kpi.id ? (
                    <form className="inline-form" onSubmit={(e) => onCreateArea(kpi.id, e)}>
                      <input name="name" required minLength={2} placeholder="new area name" aria-label="new area name" autoFocus />
                      <button className="btn-ghost" type="submit">
                        add
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setAddingAreaForKpiId(null)}>
                        close
                      </button>
                    </form>
                  ) : (
                    <button type="button" className="add-trigger" onClick={() => setAddingAreaForKpiId(kpi.id)}>
                      <FolderPlus size={16} aria-hidden="true" />
                      add evaluation area
                    </button>
                  ))}
              </div>
            )}
          </article>
        ))
      )}
    </PortalShell>
  );
}
