'use client';

import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface DemoDataStatus {
  present: boolean;
  counts: {
    users: number;
    kpis: number;
    forms: number;
    roles: number;
    departments: number;
    submissions: number;
  };
  demoPassword: string;
  demoUsers: string[];
}

export default function SettingsPage() {
  const user = useSession();
  const [status, setStatus] = useState<DemoDataStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => api<DemoDataStatus>('/v1/settings/demo-data').then(setStatus), []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function run(method: 'POST' | 'DELETE', confirmText: string | null, successNote: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setStatus(await api<DemoDataStatus>('/v1/settings/demo-data', { method }));
      setNotice(successNote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell user={user}>
      <h1>settings</h1>
      <p className="portal-subtitle">platform administration</p>

      <section className="admin-card">
        <h2>demo data</h2>
        <p className="muted">
          Seed a complete, clearly-tagged sandbox — users, a custom role, departments, KPIs with
          12 periods of history, and a form with submissions — to test dashboards, forms, users,
          and KPIs end-to-end. Removing it deletes only tagged records; real data is untouched.
        </p>

        {status === null ? (
          <p className="muted">loading…</p>
        ) : (
          <>
            <table className="data-table demo-status-table">
              <tbody>
                <tr>
                  <th>status</th>
                  <td>{status.present ? 'demo data present' : 'no demo data'}</td>
                </tr>
                <tr>
                  <th>records</th>
                  <td>
                    {status.counts.users} users · {status.counts.roles} role ·{' '}
                    {status.counts.departments} departments · {status.counts.kpis} KPIs ·{' '}
                    {status.counts.forms} form · {status.counts.submissions} submissions
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="page-title-row" style={{ justifyContent: 'flex-start' }}>
              <button
                className="btn-primary"
                disabled={busy || status.present}
                onClick={() => run('POST', null, 'demo data created — check the dashboard and forms')}
              >
                {busy ? 'working…' : 'add demo data'}
              </button>
              <button
                className="btn-ghost"
                disabled={busy || !status.present}
                onClick={() =>
                  run(
                    'DELETE',
                    'Remove all demo data? Only demo-tagged records are deleted.',
                    'demo data removed',
                  )
                }
              >
                remove demo data
              </button>
            </div>

            {status.present && (
              <div className="demo-credentials">
                <h3>try a role-scoped view</h3>
                <p className="muted">
                  Sign in as a demo user (private window) to see dashboards and permissions scoped
                  to a non-admin role. Password for all demo users:{' '}
                  <code>{status.demoPassword}</code>
                </p>
                <ul>
                  {status.demoUsers.map((email) => (
                    <li key={email}>
                      <code>{email}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {notice && <p className="form-notice">{notice}</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    </PortalShell>
  );
}
