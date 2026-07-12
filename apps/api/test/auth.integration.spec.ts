import { describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Auth integration tests — live API + Postgres + Redis (seeded admin).
 * Pins the full HTTP contract: envelope shape, httpOnly refresh cookie,
 * rotation on refresh, reuse-as-theft revocation, and /me protection.
 */
const BASE = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@pulse.local',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026',
};

const api = () => request(BASE);
const cookiesOf = (res: request.Response): string[] => ([] as string[]).concat(res.headers['set-cookie'] ?? []);
const refreshCookie = (res: request.Response) => cookiesOf(res).find((c) => c.startsWith('pulse_rt='));

describe('auth flow', () => {
  it('logs in: grant in envelope, refresh token ONLY in an httpOnly cookie', async () => {
    const res = await api().post('/api/v1/auth/login').send(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        accessToken: expect.any(String),
        expiresIn: 900,
        user: { email: ADMIN.email, roles: expect.arrayContaining(['admin']) },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('pulse_rt');

    const cookie = refreshCookie(res)!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('rejects bad credentials with the standard envelope and no cookie', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'definitely-wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
    expect(refreshCookie(res)).toBeUndefined();
  });

  it('refresh rotates the token; replaying the old one revokes the session family', async () => {
    const login = await api().post('/api/v1/auth/login').send(ADMIN);
    const firstCookie = refreshCookie(login)!;

    // rotate
    const refreshed = await api().post('/api/v1/auth/refresh').set('Cookie', firstCookie);
    expect(refreshed.status).toBe(200);
    const secondCookie = refreshCookie(refreshed)!;
    expect(secondCookie).not.toBe(firstCookie);

    // replaying the consumed token = theft signal
    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', firstCookie);
    expect(replay.status).toBe(401);

    // …which must also have killed the rotated descendant
    const descendant = await api().post('/api/v1/auth/refresh').set('Cookie', secondCookie);
    expect(descendant.status).toBe(401);
  });

  it('protects /me and serves the profile with a valid access token', async () => {
    const anonymous = await api().get('/api/v1/auth/me');
    expect(anonymous.status).toBe(401);

    const login = await api().post('/api/v1/auth/login').send(ADMIN);
    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.body.data).toMatchObject({ email: ADMIN.email, roles: expect.any(Array) });
  });

  it('logout revokes the session and clears the cookie', async () => {
    const login = await api().post('/api/v1/auth/login').send(ADMIN);
    const cookie = refreshCookie(login)!;

    const logout = await api().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);
    expect(refreshCookie(logout)).toContain('pulse_rt=;'); // cleared

    const afterLogout = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });

  describe('change-password', () => {
    it('requires authentication', async () => {
      const res = await api()
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: ADMIN.password, newPassword: 'irrelevant123' });
      expect(res.status).toBe(401);
    });

    // Doesn't exercise the success path here — it would rotate the seeded
    // admin's real password out from under every other test in the suite.
    // The full happy path (rehash + session revocation + audit log) is
    // covered against injected doubles in auth.service.spec.ts.
    it('rejects the wrong current password without touching anything', async () => {
      const login = await api().post('/api/v1/auth/login').send(ADMIN);
      const res = await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .send({ currentPassword: 'definitely-wrong', newPassword: 'irrelevant123' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');

      // the admin can still log in with their real password afterward
      const stillWorks = await api().post('/api/v1/auth/login').send(ADMIN);
      expect(stillWorks.status).toBe(200);
    });
  });

  describe('forgot-password / reset-password', () => {
    it('always returns success, whether or not the email matches an account (no enumeration)', async () => {
      const known = await api().post('/api/v1/auth/forgot-password').send({ email: ADMIN.email });
      const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody-here@pulse.local' });

      expect(known.status).toBe(200);
      expect(known.body).toMatchObject({ success: true });
      expect(unknown.status).toBe(200);
      expect(unknown.body).toMatchObject({ success: true });
    });

    it('rejects an unknown/invalid reset token', async () => {
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: 'not-a-real-token', newPassword: 'irrelevant123' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});
