'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@pulse/contracts';
import { can } from './portal-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../lib/api-client';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  department: { id: string; name: string } | null;
  roles: Array<{ id: string; name: string }>;
}

interface RoleRow {
  id: string;
  name: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

/** Create accounts, assign roles, and manage access tiers — shared between
 *  the standalone /admin/users page and the settings "team members" tab. */
export function TeamMembersManager({ user }: { user: AuthenticatedUser | null }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [pendingRoleIds, setPendingRoleIds] = useState<Set<string>>(new Set());
  const [savingRoles, setSavingRoles] = useState(false);
  const [editingInfoId, setEditingInfoId] = useState<string | null>(null);
  const [infoDraft, setInfoDraft] = useState({ displayName: '', email: '', departmentId: '' });
  const [savingInfo, setSavingInfo] = useState(false);

  const reload = useCallback(() => api<UserRow[]>('/v1/users?pageSize=100').then(setUsers), []);

  useEffect(() => {
    if (!user) return;
    void reload();
    if (can(user, 'roles:read') || can(user, 'roles:manage')) void api<RoleRow[]>('/v1/roles').then(setRoles);
    if (can(user, 'departments:read')) void api<DepartmentRow[]>('/v1/departments').then(setDepartments);
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await api('/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          displayName: form.get('displayName'),
          password: form.get('password'),
          departmentId: form.get('departmentId') || undefined,
          roleIds: form.getAll('roleIds'),
        }),
      });
      (event.target as HTMLFormElement).reset();
      setNotice('user created');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the user failed');
    }
  }

  async function onToggleStatus(row: UserRow) {
    setError(null);
    try {
      await api(`/v1/users/${row.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating status failed');
    }
  }

  function onStartEditRoles(row: UserRow) {
    setError(null);
    setEditingUserId(row.id);
    setPendingRoleIds(new Set(row.roles.map((r) => r.id)));
  }

  function onCancelEditRoles() {
    setEditingUserId(null);
    setPendingRoleIds(new Set());
  }

  function onTogglePendingRole(roleId: string) {
    setPendingRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  async function onSaveRoles(row: UserRow) {
    setError(null);
    setSavingRoles(true);
    try {
      const current = new Set(row.roles.map((r) => r.id));
      const toAdd = [...pendingRoleIds].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !pendingRoleIds.has(id));
      await Promise.all([
        ...toAdd.map((roleId) => api(`/v1/roles/${roleId}/users/${row.id}`, { method: 'POST' })),
        ...toRemove.map((roleId) => api(`/v1/roles/${roleId}/users/${row.id}`, { method: 'DELETE' })),
      ]);
      setEditingUserId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating roles failed');
    } finally {
      setSavingRoles(false);
    }
  }

  function onStartEditInfo(row: UserRow) {
    setError(null);
    setEditingInfoId(row.id);
    setInfoDraft({ displayName: row.displayName, email: row.email, departmentId: row.department?.id ?? '' });
  }

  function onCancelEditInfo() {
    setEditingInfoId(null);
  }

  async function onSaveInfo(row: UserRow) {
    setError(null);
    setSavingInfo(true);
    try {
      await api(`/v1/users/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: infoDraft.displayName,
          email: infoDraft.email,
          departmentId: infoDraft.departmentId || null,
        }),
      });
      setEditingInfoId(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the user failed');
    } finally {
      setSavingInfo(false);
    }
  }

  const canEditRoles = can(user, 'roles:manage') && can(user, 'users:write');

  return (
    <>
      {can(user, 'users:write') && (
        <Card>
          <CardContent className="pt-6">
            <form className="builder" onSubmit={onCreate}>
              <h2 className="text-lg font-semibold mb-2">new user</h2>
              <label htmlFor="u-email">email</label>
              <Input id="u-email" name="email" type="email" required />
              <label htmlFor="u-name">display name</label>
              <Input id="u-name" name="displayName" required minLength={2} />
              <label htmlFor="u-pass">temporary password</label>
              <Input id="u-pass" name="password" type="password" required minLength={8} />
              {departments.length > 0 && (
                <>
                  <label htmlFor="u-dept">department</label>
                  {/* Radix Select renders a hidden native <select> in sync with its
                      value when given a `name`, so this still participates in the
                      surrounding form's FormData on submit like a native <select>. */}
                  <Select name="departmentId">
                    <SelectTrigger id="u-dept">
                      <SelectValue placeholder="— none —" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              {roles.length > 0 && (
                <>
                  <span className="field-label">roles</span>
                  <span className="check-group">
                    {roles.map((r) => (
                      <label key={r.id} className="check-item">
                        <Checkbox name="roleIds" value={r.id} /> {r.name}
                      </label>
                    ))}
                  </span>
                </>
              )}
              <Button type="submit">create user</Button>
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
            </form>
          </CardContent>
        </Card>
      )}

      {users === null ? (
        <LoadingState />
      ) : users.length === 0 ? (
        <div className="empty-state">
          <h2>no users yet</h2>
          <p className="muted">create the first account above to start granting access.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>name</TableHead>
              <TableHead>email</TableHead>
              <TableHead>department</TableHead>
              <TableHead>roles</TableHead>
              <TableHead>status</TableHead>
              {(can(user, 'users:manage') || can(user, 'users:write') || canEditRoles) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Input
                      aria-label="display name"
                      value={infoDraft.displayName}
                      onChange={(e) => setInfoDraft((d) => ({ ...d, displayName: e.target.value }))}
                    />
                  ) : (
                    row.displayName
                  )}
                </TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Input
                      aria-label="email"
                      type="email"
                      value={infoDraft.email}
                      onChange={(e) => setInfoDraft((d) => ({ ...d, email: e.target.value }))}
                    />
                  ) : (
                    row.email
                  )}
                </TableCell>
                <TableCell>
                  {editingInfoId === row.id ? (
                    <Select
                      value={infoDraft.departmentId || '__none__'}
                      onValueChange={(v) => setInfoDraft((d) => ({ ...d, departmentId: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger aria-label="department" size="sm" className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    row.department?.name ?? '—'
                  )}
                </TableCell>
                <TableCell>
                  {editingUserId === row.id ? (
                    <span className="check-group">
                      {roles.map((r) => (
                        <label key={r.id} className="check-item">
                          <Checkbox
                            checked={pendingRoleIds.has(r.id)}
                            onCheckedChange={() => onTogglePendingRole(r.id)}
                          />{' '}
                          {r.name}
                        </label>
                      ))}
                    </span>
                  ) : (
                    row.roles.map((r) => r.name).join(', ') || '—'
                  )}
                </TableCell>
                <TableCell>{row.isActive ? 'active' : 'deactivated'}</TableCell>
                {(can(user, 'users:manage') || can(user, 'users:write') || canEditRoles) && (
                  <TableCell>
                    <span className="builder-field-actions">
                      {can(user, 'users:write') &&
                        (editingInfoId === row.id ? (
                          <>
                            <Button size="sm" disabled={savingInfo} onClick={() => onSaveInfo(row)}>
                              save info
                            </Button>
                            <Button variant="ghost" size="sm" disabled={savingInfo} onClick={onCancelEditInfo}>
                              cancel
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onStartEditInfo(row)}>
                            edit
                          </Button>
                        ))}
                      {can(user, 'users:manage') && (
                        <Button variant="ghost" size="sm" onClick={() => onToggleStatus(row)}>
                          {row.isActive ? 'deactivate' : 'activate'}
                        </Button>
                      )}
                      {canEditRoles &&
                        (editingUserId === row.id ? (
                          <>
                            <Button size="sm" disabled={savingRoles} onClick={() => onSaveRoles(row)}>
                              save roles
                            </Button>
                            <Button variant="ghost" size="sm" disabled={savingRoles} onClick={onCancelEditRoles}>
                              cancel
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onStartEditRoles(row)}>
                            change role
                          </Button>
                        ))}
                    </span>
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
