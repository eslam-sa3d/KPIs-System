'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { Building2 } from 'lucide-react';
import { can } from './portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../lib/api-client';

interface DepartmentRow {
  id: string;
  name: string;
}

/** List and create departments — the settings "departments" tab. */
export function DepartmentsManager({ user }: { user: AuthenticatedUser | null }) {
  const [departments, setDepartments] = useState<DepartmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => api<DepartmentRow[]>('/v1/departments').then(setDepartments), []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api('/v1/departments', { method: 'POST', body: JSON.stringify({ name: form.get('name') }) });
      (event.target as HTMLFormElement).reset();
      setNotice('department created');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the department failed');
    }
  }

  return (
    <>
      {can(user, 'departments:manage') && (
        <Card>
          <CardContent className="pt-6">
            <form className="inline-form" onSubmit={onCreate}>
              <input name="name" required minLength={2} placeholder="new department name" aria-label="department name" />
              <Button type="submit">create department</Button>
            </form>
            {notice && (
              <Alert className="mt-4">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {departments === null ? (
        <LoadingState />
      ) : departments.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Building2 size={22} aria-hidden="true" />
          </span>
          <h2>no departments yet</h2>
          <p className="muted">create the first department above to start assigning users and KPIs to it.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
