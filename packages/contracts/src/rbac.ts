import { z } from 'zod';

/**
 * RBAC contract shared by API guards and the admin UI.
 * A permission is `resource:action`. Roles are dynamic rows composed by admins.
 */

export const RESOURCES = [
  'users',
  'roles',
  'departments',
  'project_groups',
  'kpis',
  'kpi_entries',
  'forms',
  'form_submissions',
  'dashboards',
  'branding',
  'settings',
  'configuration',
] as const;

/** view = read/list, edit = create/update, activate_deactivate = isActive-style
 *  status toggle, delete = permanent removal. A resource with no status concept
 *  (e.g. Department) simply never gets an activate_deactivate grant. */
export const ACTIONS = ['view', 'edit', 'activate_deactivate', 'delete'] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];
export type PermissionKey = `${Resource}:${Action}`;

export const permission = (resource: Resource, action: Action): PermissionKey => `${resource}:${action}`;

/** Row-level scope narrowing a grant beyond its resource:action pair.
 *  'department'/'project_group' resolve to the caller's OWN department/group at
 *  query time (see rbac.service.ts); 'level' is dashboards:view-specific and pairs
 *  with `scopeValues` (PerformanceLevel ids) rather than resolving from the caller. */
export const SCOPES = ['all', 'department', 'project_group', 'own', 'level'] as const;
export type Scope = (typeof SCOPES)[number];

const permissionEntrySchema = z.object({
  resource: z.enum(RESOURCES),
  action: z.enum(ACTIONS),
  scope: z.enum(SCOPES).default('all'),
  /** Only meaningful when scope = 'level': the PerformanceLevel ids this grant is
   *  restricted to. Ignored for every other scope value. */
  scopeValues: z.array(z.string().uuid()).default([]),
});

export const createRoleSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(300).optional(),
  permissions: z.array(permissionEntrySchema).min(1),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(2).max(64).optional(),
  description: z.string().max(300).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** Separate from updateRoleSchema so activating/deactivating a role is its own
 *  permission (roles:activate_deactivate) instead of bundled with renaming (roles:edit). */
export const setRoleStatusSchema = z.object({
  isActive: z.boolean(),
});

export type SetRoleStatusInput = z.infer<typeof setRoleStatusSchema>;
