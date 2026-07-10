import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(2).max(120),
  password: z.string().min(8).max(128),
  departmentId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).max(20).default([]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserStatusSchema = z.object({ isActive: z.boolean() });
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

export const createDepartmentSchema = z.object({ name: z.string().min(2).max(120) });
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({ name: z.string().min(2).max(120) });
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

/** Customizable company identity shown on the landing page and portal chrome. */
export const brandIdentitySchema = z.object({
  companyName: z.string().min(1).max(120),
  tagline: z.string().max(200).optional(),
  headline: z.string().max(120).optional(),
  /** Absolute URL or site-relative path to a logo asset. */
  logoUrl: z.string().max(500).optional(),
});

export type BrandIdentity = z.infer<typeof brandIdentitySchema>;
