'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PortalShell, can } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface KpiRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  direction: string;
  target: string | null;
  cadence: string;
  assignments: Array<{
    id: string;
    roleId: string | null;
    departmentId: string | null;
    deliveryStream: string | null;
  }>;
}

interface RoleRow {
  id: string;
  name: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

export default function KpisAdminPage() {
  const user = useSession();
  const [kpis, setKpis] = useState<KpiRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => api<KpiRow[]>('/v1/kpis?pageSize=100').then(setKpis), []);

  useEffect(() => {
    if (!user) return;
    void reload();
    if (can(user, 'roles:read')) void api<RoleRow[]>('/v1/roles').then(setRoles);
    if (can(user, 'departments:read')) void api<DepartmentRow[]>('/v1/departments').then(setDepartments);
  }, [user, reload]);

  function report(promise: Promise<unknown>, successNote: string) {
    setError(null);
    setNotice(null);
    promise
      .then(async () => {
        setNotice(successNote);
        await reload();
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'The request failed'),
      );
  }

  function onCreateKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = form.get('target');
    report(
      api('/v1/kpis', {
        method: 'POST',
        body: JSON.stringify({
          code: form.get('code'),
          name: form.get('name'),
          unit: form.get('unit'),
          direction: form.get('direction'),
          cadence: form.get('cadence'),
          target: target ? Number(target) : undefined,
        }),
      }),
      'KPI created',
    );
    (event.target as HTMLFormElement).reset();
  }

  function onAssign(kpiId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    report(
      api(`/v1/kpis/${kpiId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({
          roleId: form.get('roleId') || undefined,
          departmentId: form.get('departmentId') || undefined,
          deliveryStream: form.get('deliveryStream') || undefined,
        }),
      }),
      'mapping saved',
    );
  }

  function onRecordEntry(kpiId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    report(
      api(`/v1/kpis/${kpiId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          value: Number(form.get('value')),
          periodStart: form.get('periodStart'),
          periodEnd: form.get('periodEnd'),
        }),
      }),
      'entry recorded',
    );
    (event.target as HTMLFormElement).reset();
  }

  return (
    <PortalShell user={user}>
      <h1>KPIs</h1>
      <p className="portal-subtitle">
        define KPIs, map them to roles / departments / delivery streams, record results
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
          <label htmlFor="k-code">code (UPPER-KEBAB)</label>
          <input id="k-code" name="code" required pattern="[A-Z][A-Z0-9-]*" placeholder="DEL-VEL-01" />
          <label htmlFor="k-name">name</label>
          <input id="k-name" name="name" required minLength={2} />
          <label htmlFor="k-unit">unit</label>
          <input id="k-unit" name="unit" required placeholder="%, days, points…" />
          <label htmlFor="k-dir">direction</label>
          <select id="k-dir" name="direction" defaultValue="higher_is_better">
            <option value="higher_is_better">higher is better</option>
            <option value="lower_is_better">lower is better</option>
          </select>
          <label htmlFor="k-cad">cadence</label>
          <select id="k-cad" name="cadence" defaultValue="weekly">
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
          </select>
          <label htmlFor="k-target">target (optional)</label>
          <input id="k-target" name="target" type="number" step="any" />
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
            <h2>
              {kpi.code} <span className="muted">— {kpi.name}</span>
            </h2>
            <p className="muted">
              {kpi.unit} · {kpi.cadence} · target {kpi.target ?? '—'} ·{' '}
              {kpi.direction.replaceAll('_', ' ')} · {kpi.assignments.length} mapping(s)
            </p>

            {can(user, 'kpis:manage') && (
              <form className="inline-form" onSubmit={(e) => onAssign(kpi.id, e)}>
                <select name="roleId" defaultValue="" aria-label={`map ${kpi.code} to role`}>
                  <option value="">role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  name="departmentId"
                  defaultValue=""
                  aria-label={`map ${kpi.code} to department`}
                >
                  <option value="">department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <input name="deliveryStream" placeholder="delivery stream…" aria-label={`map ${kpi.code} to stream`} />
                <button className="btn-ghost" type="submit">
                  map
                </button>
              </form>
            )}

            {can(user, 'kpi_entries:write') && (
              <form className="inline-form" onSubmit={(e) => onRecordEntry(kpi.id, e)}>
                <input name="value" type="number" step="any" required placeholder="value" aria-label={`${kpi.code} value`} />
                <input name="periodStart" type="date" required aria-label={`${kpi.code} period start`} />
                <input name="periodEnd" type="date" required aria-label={`${kpi.code} period end`} />
                <button className="btn-ghost" type="submit">
                  record entry
                </button>
              </form>
            )}
          </article>
        ))
      )}
    </PortalShell>
  );
}
