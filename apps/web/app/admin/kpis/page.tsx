'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
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

interface UserOption {
  id: string;
  email: string;
  displayName: string;
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

export default function KpisAdminPage() {
  const user = useSession();
  const [kpis, setKpis] = useState<KpiRow[] | null>(null);
  const [people, setPeople] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renamingKpiId, setRenamingKpiId] = useState<string | null>(null);
  const [confirmDeleteKpiId, setConfirmDeleteKpiId] = useState<string | null>(null);
  const [confirmDeleteAreaId, setConfirmDeleteAreaId] = useState<string | null>(null);
  const [renamingSubCriteriaId, setRenamingSubCriteriaId] = useState<string | null>(null);
  const [confirmDeleteSubCriteriaId, setConfirmDeleteSubCriteriaId] = useState<string | null>(null);
  // per-area "record a score" draft state — searching for the evaluatee by name/email
  const [personFilters, setPersonFilters] = useState<Record<string, string>>({});
  const [pickedPersonIds, setPickedPersonIds] = useState<Record<string, string>>({});

  const reload = useCallback(() => api<KpiRow[]>('/v1/kpis?pageSize=100').then(setKpis), []);

  useEffect(() => {
    if (!user) return;
    void reload();
    void api<UserOption[]>('/v1/users?pageSize=200').then(setPeople);
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
    report(
      api('/v1/kpis', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), weight: parseWeight(form.get('weight')) }),
      }),
      'KPI created',
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
    report(
      api(`/v1/kpis/${kpiId}/areas`, {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), cadence: DEFAULT_AREA_CADENCE }),
      }),
      'evaluation area added',
    );
    (event.target as HTMLFormElement).reset();
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

  function onRecordScore(kpiId: string, areaId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const personId = pickedPersonIds[areaId];
    if (!personId) {
      setError('pick who this score is for');
      return;
    }
    void report(
      api(`/v1/kpis/${kpiId}/areas/${areaId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          personId,
          value: Number(form.get('value')),
          periodStart: form.get('periodStart'),
          periodEnd: form.get('periodEnd'),
          note: form.get('note') || undefined,
        }),
      }),
      'score recorded',
    ).then(() => {
      (event.target as HTMLFormElement).reset();
      setPersonFilters((f) => ({ ...f, [areaId]: '' }));
      setPickedPersonIds((p) => ({ ...p, [areaId]: '' }));
    });
  }

  function candidatesFor(areaId: string) {
    const filter = (personFilters[areaId] ?? '').toLowerCase();
    if (!filter) return [];
    return people.filter(
      (p) => p.displayName.toLowerCase().includes(filter) || p.email.toLowerCase().includes(filter),
    );
  }

  return (
    <PortalShell user={user}>
      <h1>KPIs</h1>
      <p className="portal-subtitle">
        define KPIs, add evaluation areas under each, and record 0–5 scores per person
      </p>

      {notice && <p className="form-notice">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {can(user, 'kpis:write') && (
        <form className="builder admin-card" onSubmit={onCreateKpi}>
          <h2>new KPI</h2>
          <label htmlFor="k-name">name</label>
          <input id="k-name" name="name" required minLength={2} placeholder="QA Lead Evaluation" />
          <label htmlFor="k-weight">weight %</label>
          <input id="k-weight" name="weight" type="number" min={0} max={100} step="0.5" placeholder="e.g. 25" />
          <button className="btn-primary" type="submit">
            create KPI
          </button>
        </form>
      )}

      {kpis === null ? (
        <p className="muted">loading…</p>
      ) : kpis.length === 0 ? (
        <div className="empty-state">
          <h2>no KPIs defined yet</h2>
        </div>
      ) : (
        kpis.map((kpi) => (
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
                <h2>
                  {kpi.name} {kpi.weight !== null && <span className="muted">· {kpi.weight}%</span>}{' '}
                  {!kpi.isActive && <span className="muted">(inactive)</span>}
                </h2>
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
            <p className="muted">{kpi.evaluationAreas.length} evaluation area(s)</p>

            <label>evaluation areas</label>
            {kpi.evaluationAreas.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>
                no evaluation areas yet — add one below.
              </p>
            ) : (
              kpi.evaluationAreas.map((area) => (
                <div key={area.id} className="builder-field">
                  <div className="page-title-row">
                    <strong>
                      {area.name}
                      {!area.isActive && <span className="muted"> (inactive)</span>}
                    </strong>
                    {can(user, 'kpis:write') && (
                      <span className="row-actions">
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

                  {can(user, 'kpi_entries:write') && (
                    <form className="inline-form" onSubmit={(e) => onRecordScore(kpi.id, area.id, e)}>
                      <input
                        value={personFilters[area.id] ?? ''}
                        onChange={(e) => {
                          setPersonFilters((f) => ({ ...f, [area.id]: e.target.value }));
                          setPickedPersonIds((p) => ({ ...p, [area.id]: '' }));
                        }}
                        placeholder="search person by name or email"
                        aria-label={`who this ${area.name} score is for`}
                      />
                      {personFilters[area.id] && !pickedPersonIds[area.id] && candidatesFor(area.id).length > 0 && (
                        <select
                          aria-label="matching people"
                          size={Math.min(5, candidatesFor(area.id).length)}
                          value=""
                          onChange={(e) => {
                            const picked = people.find((p) => p.id === e.target.value);
                            setPickedPersonIds((p) => ({ ...p, [area.id]: e.target.value }));
                            setPersonFilters((f) => ({ ...f, [area.id]: picked?.displayName ?? '' }));
                          }}
                        >
                          <option value="" disabled>
                            choose…
                          </option>
                          {candidatesFor(area.id).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.displayName} ({p.email})
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        name="value"
                        type="number"
                        min={0}
                        max={5}
                        step="0.1"
                        required
                        placeholder="score 0-5"
                        aria-label={`${area.name} score`}
                      />
                      <input name="periodStart" type="date" required aria-label={`${area.name} period start`} />
                      <input name="periodEnd" type="date" required aria-label={`${area.name} period end`} />
                      <input name="note" placeholder="note (optional)" aria-label={`${area.name} note`} />
                      <button className="btn-ghost" type="submit" disabled={!pickedPersonIds[area.id]}>
                        record score
                      </button>
                    </form>
                  )}

                  <label>sub-criteria</label>
                  {area.subCriteria.length === 0 ? (
                    <p className="muted" style={{ fontSize: 12 }}>
                      no sub-criteria yet — add one below.
                    </p>
                  ) : (
                    area.subCriteria.map((sub) => (
                      <div key={sub.id} className="page-title-row">
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
                          <span>{sub.name}</span>
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
                  {can(user, 'kpis:write') && (
                    <form className="inline-form" onSubmit={(e) => onCreateSubCriteria(kpi.id, area.id, e)}>
                      <input
                        name="name"
                        required
                        minLength={2}
                        placeholder="new sub-criteria name"
                        aria-label={`new sub-criteria under ${area.name}`}
                      />
                      <button className="btn-ghost" type="submit">
                        add sub-criteria
                      </button>
                    </form>
                  )}
                </div>
              ))
            )}

            {can(user, 'kpis:write') && (
              <form className="inline-form" onSubmit={(e) => onCreateArea(kpi.id, e)}>
                <input name="name" required minLength={2} placeholder="new area name" aria-label="new area name" />
                <button className="btn-ghost" type="submit">
                  add area
                </button>
              </form>
            )}
          </article>
        ))
      )}
    </PortalShell>
  );
}
