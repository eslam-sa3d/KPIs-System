'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PortalShell, can } from '../../../components/portal-shell';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissions: Array<{ resource: string; action: string; scope: string }>;
}

interface Catalog {
  resources: string[];
  actions: string[];
}

export default function RolesAdminPage() {
  const user = useSession();
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => api<RoleRow[]>('/v1/roles').then(setRoles), []);

  useEffect(() => {
    if (!user) return;
    void reload();
    void api<Catalog>('/v1/roles/permission-catalog').then(setCatalog);
  }, [user, reload]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const permissions = form.getAll('permissions').map((raw) => {
      const [resource, action] = String(raw).split(':');
      return { resource, action, scope: 'all' };
    });
    if (permissions.length === 0) {
      setError('Select at least one permission');
      return;
    }
    try {
      await api('/v1/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description') || undefined,
          permissions,
        }),
      });
      (event.target as HTMLFormElement).reset();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the role failed');
    }
  }

  return (
    <PortalShell user={user}>
      <h1>roles</h1>
      <p className="portal-subtitle">
        compose custom roles from the permission catalog — no deployment needed
      </p>

      {can(user, 'roles:manage') && catalog && (
        <form className="builder admin-card" onSubmit={onCreate}>
          <h2>new role</h2>
          <label htmlFor="r-name">role name</label>
          <input id="r-name" name="name" required minLength={2} />
          <label htmlFor="r-desc">description</label>
          <input id="r-desc" name="description" />
          <span className="field-label">permissions</span>
          <div className="perm-grid">
            {catalog.resources.map((resource) => (
              <fieldset key={resource} className="perm-resource">
                <legend>{resource.replace('_', ' ')}</legend>
                {catalog.actions.map((action) => (
                  <label key={action} className="check-item">
                    <input type="checkbox" name="permissions" value={`${resource}:${action}`} />
                    {action}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <button className="btn-primary" type="submit">
            create role
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      )}

      {roles === null ? (
        <p className="muted">loading…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>role</th>
              <th>members</th>
              <th>permissions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>
                  {role.name}
                  {role.isSystem && <span className="muted"> (system)</span>}
                  {role.description && <div className="muted">{role.description}</div>}
                </td>
                <td>{role.memberCount}</td>
                <td>
                  <span className="chip-row">
                    {role.permissions.map((p) => (
                      <code key={`${p.resource}:${p.action}`} className="perm-chip">
                        {p.resource}:{p.action}
                      </code>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PortalShell>
  );
}
