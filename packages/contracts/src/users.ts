import { z } from 'zod';
import { emailSchema, passwordSchema } from './primitives';

export const createUserSchema = z.object({
  email: emailSchema,
  displayName: z.string().min(2).max(120),
  password: passwordSchema,
  departmentId: z.string().uuid().optional(),
  jobTitleId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).max(20).default([]),
  /** Whether this person should be scored/tracked by the KPI system at all —
   *  false excludes them from the dashboard's team overview regardless of
   *  whether their role/department has a KPI mapped to it. */
  isKpiApplicable: z.boolean().default(true),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserStatusSchema = z.object({ isActive: z.boolean() });
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/** Admin-direct password reset (Users page "reset password" action) — sets the
 *  account's password immediately, same as the create-user flow's temporary
 *  password, rather than emailing a self-service reset link. */
export const adminResetPasswordSchema = z.object({ newPassword: passwordSchema });
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;

/** Every field optional (a caller only sends what changed); `departmentId: null`
 *  clears the department, `undefined`/omitted leaves it untouched. Same for
 *  `jobTitleId`. */
export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  displayName: z.string().min(2).max(120).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  jobTitleId: z.string().uuid().nullable().optional(),
  isKpiApplicable: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const createDepartmentSchema = z.object({ name: z.string().min(2).max(120) });
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({ name: z.string().min(2).max(120) });
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createProjectGroupSchema = z.object({ name: z.string().min(2).max(120) });
export type CreateProjectGroupInput = z.infer<typeof createProjectGroupSchema>;

export const updateProjectGroupSchema = z.object({ name: z.string().min(2).max(120) });
export type UpdateProjectGroupInput = z.infer<typeof updateProjectGroupSchema>;

/** Add one or more system users to a project group in a single call — the
 *  searchable multi-select on the admin UI posts here per batch of selections. */
export const addProjectGroupMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});
export type AddProjectGroupMembersInput = z.infer<typeof addProjectGroupMembersSchema>;

/** Customizable company identity shown on the landing page and portal chrome. */
export const brandIdentitySchema = z.object({
  companyName: z.string().min(1).max(120),
  tagline: z.string().max(200).optional(),
  headline: z.string().max(120).optional(),
  /** Absolute URL or site-relative path to a logo asset. */
  logoUrl: z.string().max(500).optional(),
});

export type BrandIdentity = z.infer<typeof brandIdentitySchema>;
