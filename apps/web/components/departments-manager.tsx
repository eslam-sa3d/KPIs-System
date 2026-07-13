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

interface GroupRow {
  id: string;
  name: string;
}

/** List, create, rename, and delete a flat named grouping (Department or
 *  Project Group) — same shape, different endpoint/permission resource, so
 *  DepartmentsManager and ProjectGroupsManager below are thin wrappers around
 *  this one implementation instead of two near-duplicate components. */
function EntityGroupManager({
  user,
  endpoint,
  resource,
  noun,
}: {
  user: AuthenticatedUser | null;
  /** e.g. '/v1/departments' */
  endpoint: string;
  /** RBAC resource prefix, e.g. 'departments' | 'project_groups' */
  resource: string;
  /** singular display noun, e.g. 'department' | 'project group' */
  noun: string;
}) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canEdit = can(user, `${resource}:edit`);
  const canDelete = can(user, `${resource}:delete`);

  const reload = useCallback(() => api<GroupRow[]>(endpoint).then(setGroups), [endpoint]);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify({ name: form.get('name') }) });
      (event.target as HTMLFormElement).reset();
      setNotice(`${noun} created`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Creating the ${noun} failed`);
    }
  }

  async function onRename(groupId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api(`${endpoint}/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name') }),
      });
      setRenamingId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Renaming the ${noun} failed`);
    }
  }

  async function onDelete(groupId: string) {
    setError(null);
    try {
      await api(`${endpoint}/${groupId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Deleting the ${noun} failed`);
    }
  }

  return (
    <>
      {canEdit && (
        <Card>
          <CardContent className="pt-6">
            <form className="inline-form" onSubmit={onCreate}>
              <Input name="name" required minLength={2} placeholder={`new ${noun} name`} aria-label={`${noun} name`} />
              <Button type="submit">create {noun}</Button>
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

      {groups === null ? (
        <LoadingState />
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Building2 size={22} aria-hidden="true" />
          </span>
          <h2>no {noun}s yet</h2>
          <p className="muted">create the first {noun} above to start assigning users to it.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>name</TableHead>
              {(canEdit || canDelete) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  {renamingId === g.id ? (
                    <form className="inline-form" onSubmit={(e) => onRename(g.id, e)}>
                      <Input name="name" defaultValue={g.name} required minLength={2} autoFocus />
                      <Button type="submit" variant="ghost" size="sm">
                        save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingId(null)}>
                        cancel
                      </Button>
                    </form>
                  ) : (
                    g.name
                  )}
                </TableCell>
                {(canEdit || canDelete) && (
                  <TableCell>
                    {renamingId !== g.id && (
                      <span className="row-actions">
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`rename ${g.name}`}
                            onClick={() => setRenamingId(g.id)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                        )}
                        {canDelete &&
                          (confirmDeleteId === g.id ? (
                            <>
                              <span className="muted">delete?</span>
                              <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(g.id)}>
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
                              onClick={() => setConfirmDeleteId(g.id)}
                            >
                              delete
                            </Button>
                          ))}
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

export function DepartmentsManager({ user }: { user: AuthenticatedUser | null }) {
  return <EntityGroupManager user={user} endpoint="/v1/departments" resource="departments" noun="department" />;
}

export function ProjectGroupsManager({ user }: { user: AuthenticatedUser | null }) {
  return (
    <EntityGroupManager user={user} endpoint="/v1/project-groups" resource="project_groups" noun="project group" />
  );
}
