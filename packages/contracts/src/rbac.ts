import { z } from 'zod';

/**
 * RBAC contract shared by API guards and the admin UI.
 * A permission is `resource:action`. Roles are dynamic rows composed by admins.
 */

export const RESOURCES = [
  'users',
  'roles',
  'kpis',
  'kpi_entries',
  'forms',
  'form_submissions',
  'dashboards',
  'branding',
] as const;

export const ACTIONS = ['read', 'write', 'execute', 'manage'] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];
export type PermissionKey = `${Resource}:${Action}`;

export const permission = (resource: Resource, action: Action): PermissionKey =>
  `${resource}:${action}`;

export const createRoleSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(300).optional(),
  permissions: z
    .array(
      z.object({
        resource: z.enum(RESOURCES),
        action: z.enum(ACTIONS),
        /** Optional row-level scope, e.g. restrict to own department. */
        scope: z.enum(['all', 'department', 'own']).default('all'),
      }),
    )
    .min(1),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
