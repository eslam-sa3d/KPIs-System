'use client';

import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '../../../components/portal-shell';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
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
  const [confirmRemove, setConfirmRemove] = useState(false);

  const reload = useCallback(() => api<DemoDataStatus>('/v1/settings/demo-data').then(setStatus), []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function run(method: 'POST' | 'DELETE', successNote: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setStatus(await api<DemoDataStatus>('/v1/settings/demo-data', { method }));
      setNotice(successNote);
      setConfirmRemove(false);
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

      <Card>
        <CardHeader>
          <CardTitle>demo data</CardTitle>
          <CardDescription>
            Seed a complete, clearly-tagged sandbox — users, a custom role, departments, KPIs with
            12 periods of history, and a form with submissions — to test dashboards, forms, users,
            and KPIs end-to-end. Removing it deletes only tagged records; real data is untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
        {status === null ? (
          <p className="muted">loading…</p>
        ) : (
          <>
            <Table className="demo-status-table">
              <TableBody>
                <TableRow>
                  <TableHead>status</TableHead>
                  <TableCell>{status.present ? 'demo data present' : 'no demo data'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableHead>records</TableHead>
                  <TableCell>
                    {status.counts.users} users · {status.counts.roles} role ·{' '}
                    {status.counts.departments} departments · {status.counts.kpis} KPIs ·{' '}
                    {status.counts.forms} form · {status.counts.submissions} submissions
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="page-title-row" style={{ justifyContent: 'flex-start' }}>
              <Button
                disabled={busy || status.present}
                onClick={() => run('POST', 'demo data created — check the dashboard and forms')}
              >
                {busy ? 'working…' : 'add demo data'}
              </Button>
              {confirmRemove ? (
                <>
                  <span className="muted">remove all demo data? only demo-tagged records are deleted.</span>
                  <Button variant="ghost" disabled={busy} onClick={() => run('DELETE', 'demo data removed')}>
                    confirm remove
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                    cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" disabled={busy || !status.present} onClick={() => setConfirmRemove(true)}>
                  remove demo data
                </Button>
              )}
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

        <div className="space-y-2 mb-4">
          {notice && (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        </CardContent>
      </Card>
    </PortalShell>
  );
}
