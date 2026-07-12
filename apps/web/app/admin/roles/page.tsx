'use client';

import { FormEvent, useState } from 'react';
import { PortalShell, can } from '../../../components/portal-shell';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';
import { useResource } from '../../../lib/use-resource';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  memberCount: number;
  permissions: Array<{ resource: string; action: string; scope: string }>;
}

interface Catalog {
  resources: string[];
  actions: string[];
}

/** Only these resources' `read` grant has a row a "department"/"own" scope
 *  can correctly filter by (User.departmentId / KpiAssignment.departmentId)
 *  — every other resource's access model (forms' restricted+collaborator
 *  system, roles/settings/branding being inherently org-wide, ...) has no
 *  department to filter by, so scope stays "all" there. Keep in sync with
 *  DEPARTMENT_SCOPABLE_RESOURCES in apps/api's rbac.service.ts. */
const SCOPABLE_READ_GRANTS = new Set(['kpis:read', 'users:read']);
const SCOPE_OPTIONS = [
  { value: 'all', label: 'all' },
  { value: 'department', label: 'own department' },
  { value: 'own', label: 'own only' },
];

export default function RolesAdminPage() {
  const user = useSession();
  const { data: roles, reload } = useResource<RoleRow[]>(user ? '/v1/roles' : null);
  const { data: catalog } = useResource<Catalog>(user ? '/v1/roles/permission-catalog' : null);
  const [error, setError] = useState<string | null>(null);
  const [renamingRoleId, setRenamingRoleId] = useState<string | null>(null);
  const [confirmDeleteRoleId, setConfirmDeleteRoleId] = useState<string | null>(null);

  async function onRename(roleId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const name = new FormData(event.currentTarget).get('name');
    try {
      await api(`/v1/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setRenamingRoleId(null);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Renaming the role failed');
    }
  }

  async function onToggleActive(role: RoleRow) {
    setError(null);
    try {
      await api(`/v1/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !role.isActive }) });
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating the role failed');
    }
  }

  async function onDelete(roleId: string) {
    setError(null);
    try {
      await api(`/v1/roles/${roleId}`, { method: 'DELETE' });
      setConfirmDeleteRoleId(null);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the role failed');
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const permissions = form.getAll('permissions').map((raw) => {
      const key = String(raw);
      const [resource, action] = key.split(':');
      const scope = SCOPABLE_READ_GRANTS.has(key) ? String(form.get(`scope:${key}`) ?? 'all') : 'all';
      return { resource, action, scope };
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
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the role failed');
    }
  }

  return (
    <PortalShell user={user}>
      <h1>roles</h1>
      <p className="portal-subtitle">compose custom roles from the permission catalog — no deployment needed</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {can(user, 'roles:manage') && catalog && (
        <Card>
          <CardContent className="pt-6">
            <form className="builder" onSubmit={onCreate}>
              <h2 className="text-lg font-semibold mb-2">new role</h2>
              <label htmlFor="r-name">role name</label>
              <Input id="r-name" name="name" required minLength={2} />
              <label htmlFor="r-desc">description</label>
              <Input id="r-desc" name="description" />
              <span className="field-label">permissions</span>
              <div className="perm-grid">
                {catalog.resources.map((resource) => (
                  <fieldset key={resource} className="perm-resource">
                    <legend>{resource.replace('_', ' ')}</legend>
                    {catalog.actions.map((action) => {
                      const key = `${resource}:${action}`;
                      const scopable = SCOPABLE_READ_GRANTS.has(key);
                      return (
                        <label key={action} className="check-item">
                          <Checkbox name="permissions" value={key} />
                          {action}
                          {scopable && (
                            <select
                              name={`scope:${key}`}
                              defaultValue="all"
                              aria-label={`${key} scope`}
                              style={{ fontSize: 12, marginInlineStart: 4 }}
                            >
                              {SCOPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
              <Button type="submit">create role</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {roles === null ? (
        <LoadingState />
      ) : roles.length === 0 ? (
        <div className="empty-state">
          <h2>no roles yet</h2>
          <p className="muted">create the first custom role above to start composing access tiers.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>role</TableHead>
              <TableHead>members</TableHead>
              <TableHead>permissions</TableHead>
              {can(user, 'roles:manage') && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  {renamingRoleId === role.id ? (
                    <form className="inline-form" onSubmit={(e) => onRename(role.id, e)}>
                      <Input name="name" defaultValue={role.name} required minLength={2} autoFocus />
                      <Button type="submit" variant="ghost" size="sm">
                        save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingRoleId(null)}>
                        cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      {role.name}
                      {role.isSystem && <span className="muted"> (system)</span>}
                      {!role.isActive && <span className="muted"> (deactivated)</span>}
                      {role.description && <div className="muted">{role.description}</div>}
                    </>
                  )}
                </TableCell>
                <TableCell>{role.memberCount}</TableCell>
                <TableCell>
                  <span className="chip-row">
                    {role.permissions.map((p) => (
                      <code key={`${p.resource}:${p.action}`} className="perm-chip">
                        {p.resource}:{p.action}
                        {p.scope !== 'all' && ` (${p.scope})`}
                      </code>
                    ))}
                  </span>
                </TableCell>
                {can(user, 'roles:manage') && (
                  <TableCell>
                    {!role.isSystem && renamingRoleId !== role.id && (
                      <span className="builder-field-actions">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingRoleId(role.id)}>
                          rename
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onToggleActive(role)}>
                          {role.isActive ? 'deactivate' : 'reactivate'}
                        </Button>
                        {confirmDeleteRoleId === role.id ? (
                          <>
                            <span className="muted">delete permanently?</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(role.id)}>
                              confirm delete
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDeleteRoleId(null)}
                            >
                              cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteRoleId(role.id)}
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
    </PortalShell>
  );
}
