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
}

/** Body of POST /auth/login and /auth/refresh. The refresh token itself
 *  travels only in an httpOnly cookie — never in the JSON body. */
export interface TokenGrant {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthenticatedUser;
}
