'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { Building2, Pencil } from 'lucide-react';
import { can } from './portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../lib/api-client';

interface DepartmentRow {
  id: string;
  name: string;
}

/** List, create, rename, and delete departments — the settings "departments" tab. */
export function DepartmentsManager({ user }: { user: AuthenticatedUser | null }) {
  const [departments, setDepartments] = useState<DepartmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canManage = can(user, 'departments:manage');

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

  async function onRename(departmentId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/v1/departments/${departmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name') }),
      });
      setRenamingId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Renaming the department failed');
    }
  }

  async function onDelete(departmentId: string) {
    setError(null);
    try {
      await api(`/v1/departments/${departmentId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the department failed');
    }
  }

  return (
    <>
      {canManage && (
        <Card>
          <CardContent className="pt-6">
            <form className="inline-form" onSubmit={onCreate}>
              <Input
                name="name"
                required
                minLength={2}
                placeholder="new department name"
                aria-label="department name"
              />
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
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  {renamingId === d.id ? (
                    <form className="inline-form" onSubmit={(e) => onRename(d.id, e)}>
                      <Input name="name" defaultValue={d.name} required minLength={2} autoFocus />
                      <Button type="submit" variant="ghost" size="sm">
                        save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingId(null)}>
                        cancel
                      </Button>
                    </form>
                  ) : (
                    d.name
                  )}
                </TableCell>
                {canManage && (
                  <TableCell>
                    {renamingId !== d.id && (
                      <span className="row-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`rename ${d.name}`}
                          onClick={() => setRenamingId(d.id)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        {confirmDeleteId === d.id ? (
                          <>
                            <span className="muted">delete?</span>
                            <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(d.id)}>
                              confirm
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                              cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setConfirmDeleteId(d.id)}
                          >
                            delete
                          </Button>
                        )}
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
