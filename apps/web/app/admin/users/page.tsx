'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PortalShell, can } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

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

export default function UsersAdminPage() {
  const user = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [pendingRoleIds, setPendingRoleIds] = useState<Set<string>>(new Set());
  const [savingRoles, setSavingRoles] = useState(false);

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

  return (
    <PortalShell user={user}>
      <h1>users</h1>
      <p className="portal-subtitle">create accounts, assign roles, and manage access tiers</p>

      {can(user, 'users:write') && (
        <form className="builder admin-card" onSubmit={onCreate}>
          <h2>new user</h2>
          <label htmlFor="u-email">email</label>
          <input id="u-email" name="email" type="email" required />
          <label htmlFor="u-name">display name</label>
          <input id="u-name" name="displayName" required minLength={2} />
          <label htmlFor="u-pass">temporary password</label>
          <input id="u-pass" name="password" type="password" required minLength={8} />
          {departments.length > 0 && (
            <>
              <label htmlFor="u-dept">department</label>
              <select id="u-dept" name="departmentId" defaultValue="">
                <option value="">— none —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {roles.length > 0 && (
            <>
              <span className="field-label">roles</span>
              <span className="check-group">
                {roles.map((r) => (
                  <label key={r.id} className="check-item">
                    <input type="checkbox" name="roleIds" value={r.id} /> {r.name}
                  </label>
                ))}
              </span>
            </>
          )}
          <button className="btn-primary" type="submit">
            create user
          </button>
          {notice && <p className="form-notice">{notice}</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      )}

      {(() => {
        const canEditRoles = can(user, 'roles:manage') && can(user, 'users:write');
        return users === null ? (
          <p className="muted">loading…</p>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <h2>no users yet</h2>
            <p className="muted">create the first account above to start granting access.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>name</th>
                <th>email</th>
                <th>department</th>
                <th>roles</th>
                <th>status</th>
                {(can(user, 'users:manage') || canEditRoles) && <th />}
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id}>
                  <td>{row.displayName}</td>
                  <td>{row.email}</td>
                  <td>{row.department?.name ?? '—'}</td>
                  <td>
                    {editingUserId === row.id ? (
                      <span className="check-group">
                        {roles.map((r) => (
                          <label key={r.id} className="check-item">
                            <input
                              type="checkbox"
                              checked={pendingRoleIds.has(r.id)}
                              onChange={() => onTogglePendingRole(r.id)}
                            />{' '}
                            {r.name}
                          </label>
                        ))}
                      </span>
                    ) : (
                      row.roles.map((r) => r.name).join(', ') || '—'
                    )}
                  </td>
                  <td>{row.isActive ? 'active' : 'deactivated'}</td>
                  {(can(user, 'users:manage') || canEditRoles) && (
                    <td>
                      <span className="builder-field-actions">
                        {can(user, 'users:manage') && (
                          <button className="btn-ghost" onClick={() => onToggleStatus(row)}>
                            {row.isActive ? 'deactivate' : 'activate'}
                          </button>
                        )}
                        {canEditRoles &&
                          (editingUserId === row.id ? (
                            <>
                              <button
                                className="btn-primary"
                                disabled={savingRoles}
                                onClick={() => onSaveRoles(row)}
                              >
                                save roles
                              </button>
                              <button className="btn-ghost" disabled={savingRoles} onClick={onCancelEditRoles}>
                                cancel
                              </button>
                            </>
                          ) : (
                            <button className="btn-ghost" onClick={() => onStartEditRoles(row)}>
                              change role
                            </button>
                          ))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}
    </PortalShell>
  );
}
