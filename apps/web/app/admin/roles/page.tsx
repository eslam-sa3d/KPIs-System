'use client';

import { Fragment, FormEvent, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  FileText,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Palette,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
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
import { useReveal } from '../../../lib/use-reveal';

interface PermissionGrant {
  resource: string;
  action: string;
  scope: string;
  scopeValues: string[];
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  memberCount: number;
  permissions: PermissionGrant[];
}

interface Catalog {
  resources: string[];
  actions: string[];
  scopes: string[];
}

interface PerformanceLevelOption {
  id: string;
  label: string;
}

/** Friendlier labels than the raw resource/action strings the catalog returns. */
const RESOURCE_LABEL: Record<string, string> = {
  users: 'users',
  roles: 'roles',
  departments: 'departments',
  project_groups: 'project groups',
  kpis: 'KPIs',
  kpi_entries: 'KPI entries',
  forms: 'forms',
  form_submissions: 'form submissions',
  dashboards: 'dashboard',
  branding: 'branding',
  settings: 'settings',
  configuration: 'configuration',
};

const ACTION_LABEL: Record<string, string> = {
  view: 'view',
  edit: 'edit',
  activate_deactivate: 'activate / deactivate',
  delete: 'delete',
};

/** One small glance-cue per resource card — purely visual, matching this
 *  page's existing sparing use of lucide icons (see the "new role" button)
 *  rather than introducing a heavier icon language the rest of the app
 *  (plain text nav, no icons) doesn't otherwise use. */
const RESOURCE_ICON: Record<string, LucideIcon> = {
  users: Users,
  roles: ShieldCheck,
  departments: Building2,
  project_groups: FolderKanban,
  kpis: Target,
  kpi_entries: ClipboardList,
  forms: FileText,
  form_submissions: Inbox,
  dashboards: LayoutDashboard,
  branding: Palette,
  settings: Settings2,
  configuration: SlidersHorizontal,
};

/** Only these resources' `view` grant has a row a "department"/"project_group"/
 *  "own" scope can correctly filter by (User.departmentId/projectGroupId,
 *  KpiAssignment.departmentId) — every other resource's access model (forms'
 *  restricted+collaborator system, roles/settings/branding being inherently
 *  org-wide, ...) has nothing to filter by, so scope stays "all" there. Keep
 *  in sync with DEPARTMENT_SCOPABLE_RESOURCES/PROJECT_GROUP_SCOPABLE_RESOURCES
 *  in apps/api's rbac.service.ts. */
const DEPARTMENT_GROUP_SCOPABLE_GRANTS = new Set(['kpis:view', 'users:view']);
const DEPARTMENT_GROUP_SCOPE_OPTIONS = [
  { value: 'all', label: 'all' },
  { value: 'department', label: 'own department' },
  { value: 'project_group', label: 'own project group' },
  { value: 'own', label: 'own only' },
];

/** dashboards:view is scoped differently — "all" or restricted to specific
 *  Performance Level bands, not department/project_group. */
const DASHBOARD_SCOPE_KEY = 'dashboards:view';

function permKey(resource: string, action: string) {
  return `${resource}:${action}`;
}

/** The permission checkbox/scope grid, shared by "create role" and each
 *  role's "edit permissions" panel — same fields, different defaults and
 *  submit target. Uncontrolled (FormData-read) except for the one bit that
 *  needs reactivity: dashboards:view's scope toggles whether the Performance
 *  Level checkboxes are shown at all. */
function PermissionFields({
  catalog,
  performanceLevels,
  defaultPermissions,
}: {
  catalog: Catalog;
  performanceLevels: PerformanceLevelOption[];
  defaultPermissions: PermissionGrant[];
}) {
  const byKey = new Map(defaultPermissions.map((p) => [permKey(p.resource, p.action), p]));
  const [dashboardScope, setDashboardScope] = useState(byKey.get(DASHBOARD_SCOPE_KEY)?.scope ?? 'all');

  return (
    <div>
      <p className="perm-grid-hint">grouped by resource — check an action to grant it</p>
      <div className="perm-grid">
        {catalog.resources
          .filter((resource) => resource !== 'dashboards')
          .map((resource) => {
            const ResourceIcon = RESOURCE_ICON[resource];
            return (
              <fieldset key={resource} className="perm-resource">
                <legend>
                  {ResourceIcon && <ResourceIcon size={14} aria-hidden="true" className="perm-resource-icon" />}
                  {RESOURCE_LABEL[resource] ?? resource.replace('_', ' ')}
                </legend>
                {catalog.actions.map((action) => {
                  const key = permKey(resource, action);
                  const scopable = DEPARTMENT_GROUP_SCOPABLE_GRANTS.has(key);
                  const existing = byKey.get(key);
                  return (
                    <label key={action} className="check-item" data-action={action}>
                      <Checkbox name="permissions" value={key} defaultChecked={Boolean(existing)} />
                      {ACTION_LABEL[action] ?? action}
                      {scopable && (
                        <select
                          name={`scope:${key}`}
                          defaultValue={existing?.scope ?? 'all'}
                          aria-label={`${key} scope`}
                          className="perm-scope-select"
                        >
                          {DEPARTMENT_GROUP_SCOPE_OPTIONS.map((opt) => (
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
            );
          })}

        {/* dashboards:view gets its own block — "all" or restricted to specific
            Performance Level bands, not the department/project_group scopes above. */}
        <fieldset className="perm-resource">
          <legend>
            <LayoutDashboard size={14} aria-hidden="true" className="perm-resource-icon" />
            {RESOURCE_LABEL.dashboards}
          </legend>
          <label className="check-item" data-action="view">
            <Checkbox
              name="permissions"
              value={DASHBOARD_SCOPE_KEY}
              defaultChecked={Boolean(byKey.get(DASHBOARD_SCOPE_KEY))}
            />
            view
            <select
              name={`scope:${DASHBOARD_SCOPE_KEY}`}
              value={dashboardScope}
              onChange={(e) => setDashboardScope(e.target.value)}
              aria-label={`${DASHBOARD_SCOPE_KEY} scope`}
              className="perm-scope-select"
            >
              <option value="all">all levels</option>
              <option value="level">specific level(s)</option>
            </select>
          </label>
          {dashboardScope === 'level' && (
            <div className="check-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              {performanceLevels.length === 0 ? (
                <span className="muted">no performance levels configured yet</span>
              ) : (
                performanceLevels.map((level) => (
                  <label key={level.id} className="check-item" style={{ marginInlineStart: 20 }}>
                    <Checkbox
                      name={`scopeValues:${DASHBOARD_SCOPE_KEY}`}
                      value={level.id}
                      defaultChecked={byKey.get(DASHBOARD_SCOPE_KEY)?.scopeValues.includes(level.id) ?? false}
                    />
                    {level.label}
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
}

/** Reads the PermissionFields grid back out of a submitted form. */
function readPermissions(form: FormData): PermissionGrant[] {
  return form
    .getAll('permissions')
    .map((raw) => String(raw))
    .map((key) => {
      const [resource, action] = key.split(':');
      const scope = String(form.get(`scope:${key}`) ?? 'all');
      const scopeValues = scope === 'level' ? form.getAll(`scopeValues:${key}`).map(String) : [];
      return { resource: resource!, action: action!, scope, scopeValues };
    });
}

export default function RolesAdminPage() {
  const user = useSession();
  const { data: roles, reload } = useResource<RoleRow[]>(user ? '/v1/roles' : null);
  const { data: catalog } = useResource<Catalog>(user ? '/v1/roles/permission-catalog' : null);
  const { data: performanceLevels } = useResource<PerformanceLevelOption[]>(user ? '/v1/performance-levels' : null);
  const [error, setError] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [renamingRoleId, setRenamingRoleId] = useState<string | null>(null);
  const [editingPermissionsRoleId, setEditingPermissionsRoleId] = useState<string | null>(null);
  const [confirmDeleteRoleId, setConfirmDeleteRoleId] = useState<string | null>(null);

  const canEdit = can(user, 'roles:edit');
  const canToggleStatus = can(user, 'roles:activate_deactivate');
  const canDelete = can(user, 'roles:delete');
  const canManageColumn = canEdit || canToggleStatus || canDelete;

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
      await api(`/v1/roles/${role.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !role.isActive }) });
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
    const permissions = readPermissions(form);
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
      setCreatingRole(false);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creating the role failed');
    }
  }

  async function onSavePermissions(roleId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const permissions = readPermissions(new FormData(event.currentTarget));
    if (permissions.length === 0) {
      setError('Select at least one permission');
      return;
    }
    try {
      await api(`/v1/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify(permissions) });
      setEditingPermissionsRoleId(null);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Updating permissions failed');
    }
  }

  const scopeRef = useReveal<HTMLDivElement>('tbody tr', roles !== null && roles.length > 0);

  return (
    <PortalShell user={user}>
      <div ref={scopeRef}>
        <div className="page-title-row">
          <h1>roles</h1>
          {canEdit && catalog && !creatingRole && (
            <Button
              type="button"
              variant="outline"
              className="border-dashed text-muted-foreground hover:border-primary hover:text-primary"
              onClick={() => setCreatingRole(true)}
            >
              <Plus size={16} aria-hidden="true" />
              new role
            </Button>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {canEdit && catalog && creatingRole && (
          <Card>
            <CardContent className="pt-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-2 -ml-2 text-muted-foreground hover:text-foreground"
                onClick={() => setCreatingRole(false)}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                back to roles
              </Button>
              <form className="builder" onSubmit={onCreate}>
                <h2 className="text-lg font-semibold mb-2">new role</h2>
                <label htmlFor="r-name">role name</label>
                <Input id="r-name" name="name" required minLength={2} autoFocus />
                <label htmlFor="r-desc">description</label>
                <Input id="r-desc" name="description" />
                <span className="field-label">permissions</span>
                <PermissionFields
                  catalog={catalog}
                  performanceLevels={performanceLevels ?? []}
                  defaultPermissions={[]}
                />
                <span className="builder-field-actions">
                  <Button type="submit">create role</Button>
                  <Button type="button" variant="ghost" onClick={() => setCreatingRole(false)}>
                    cancel
                  </Button>
                </span>
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
                {canManageColumn && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <Fragment key={role.id}>
                  <TableRow>
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
                          <code key={permKey(p.resource, p.action)} className="perm-chip">
                            {RESOURCE_LABEL[p.resource] ?? p.resource}:{ACTION_LABEL[p.action] ?? p.action}
                            {p.scope !== 'all' &&
                              ` (${p.scope}${p.scope === 'level' ? `: ${p.scopeValues.length}` : ''})`}
                          </code>
                        ))}
                      </span>
                    </TableCell>
                    {canManageColumn && (
                      <TableCell>
                        {!role.isSystem && renamingRoleId !== role.id && (
                          <span className="builder-field-actions">
                            {canEdit && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setRenamingRoleId(role.id)}
                              >
                                rename
                              </Button>
                            )}
                            {canEdit && catalog && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setEditingPermissionsRoleId(editingPermissionsRoleId === role.id ? null : role.id)
                                }
                              >
                                {editingPermissionsRoleId === role.id ? 'close' : 'edit permissions'}
                              </Button>
                            )}
                            {canToggleStatus && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => onToggleActive(role)}>
                                {role.isActive ? 'deactivate' : 'reactivate'}
                              </Button>
                            )}
                            {canDelete &&
                              (confirmDeleteRoleId === role.id ? (
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
                              ))}
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                  {editingPermissionsRoleId === role.id && catalog && (
                    <TableRow key={`${role.id}-edit-permissions`}>
                      <TableCell colSpan={canManageColumn ? 4 : 3}>
                        <form key={role.id} className="builder" onSubmit={(e) => onSavePermissions(role.id, e)}>
                          <PermissionFields
                            catalog={catalog}
                            performanceLevels={performanceLevels ?? []}
                            defaultPermissions={role.permissions}
                          />
                          <span className="builder-field-actions">
                            <Button type="submit" size="sm">
                              save permissions
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingPermissionsRoleId(null)}
                            >
                              cancel
                            </Button>
                          </span>
                        </form>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PortalShell>
  );
}
