import { z } from 'zod';

/** Shared across every schema that accepts a user's email address (login,
 *  forgot-password, user create/update) — one place to change the max
 *  length or add stricter validation later. */
export const emailSchema = z.string().email().max(254);

/** Shared across every schema that accepts a plaintext password (login,
 *  change/reset/admin-reset password, user create) — one place to change
 *  the length bounds or add a strength requirement later. */
export const passwordSchema = z.string().min(8).max(128);
