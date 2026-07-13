import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Payload embedded in the (short-lived) access JWT. */
export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  /** Effective permission keys (`resource:action`), union across roles —
   *  the UI uses these to gate navigation and controls. */
  permissions: string[];
  /** True when an admin issued this account's current password (e.g. a
   *  freshly created user) — the web app forces a change-password screen
   *  before anything else until this clears. */
  mustChangePassword: boolean;
}

/** Body of POST /auth/login and /auth/refresh. The refresh token itself
 *  travels only in an httpOnly cookie — never in the JSON body. */
export interface TokenGrant {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthenticatedUser;
}
