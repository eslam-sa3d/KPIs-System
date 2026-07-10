import { describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Integration tests — run against a live API + Postgres + Redis
 * (docker services in CI, `docker compose up` locally).
 *
 *   API_URL=http://localhost:4000 pnpm test:integration
 *
 * Asserts the full contract: auth → RBAC → validation → envelope shape.
 */
const api = () => request(process.env.API_URL ?? 'http://localhost:4000');

async function loginAsAdmin(): Promise<string> {
  const res = await api()
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@pulse.local',
      password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026',
    });
  expect(res.body.success).toBe(true);
  return res.body.data.accessToken as string;
}

describe('API contract (envelope + auth + RBAC)', () => {
  it('rejects unauthenticated requests with the standard error envelope', async () => {
    const res = await api().get('/api/v1/forms/anything');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
      meta: { requestId: expect.any(String), timestamp: expect.any(String) },
    });
  });

  it('creates a form, submits, and lists with pagination meta', async () => {
    const token = await loginAsAdmin();
    const slug = `it-form-${Date.now()}`;

    const created = await api()
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug,
        definition: {
          title: 'integration form',
          fields: [{ key: 'team', label: 'Team', type: 'short_text', required: true }],
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);

    const submitted = await api()
      .post(`/api/v1/forms/${slug}/submissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ team: 'delivery' });
    expect(submitted.body.success).toBe(true);

    const listed = await api()
      .get(`/api/v1/forms/${slug}/submissions?page=1&pageSize=10`)
      .set('Authorization', `Bearer ${token}`);
    expect(listed.body).toMatchObject({
      success: true,
      data: [expect.objectContaining({ answers: { team: 'delivery' } })],
      meta: { pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 } },
    });
  });

  it('returns 422 VALIDATION_ERROR with field paths for a bad submission', async () => {
    const token = await loginAsAdmin();
    const slug = `it-form-invalid-${Date.now()}`;

    await api()
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug,
        definition: {
          title: 'strict form',
          fields: [
            { key: 'score', label: 'Score', type: 'number', required: true, min: 0, max: 10 },
          ],
        },
      });

    const res = await api()
      .post(`/api/v1/forms/${slug}/submissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ score: 99 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toContain('score');
  });

  it('creates, renames, and deletes a department end to end', async () => {
    const token = await loginAsAdmin();
    const name = `it-dept-${Date.now()}`;
    const auth = () => api().set('Authorization', `Bearer ${token}`);

    const created = await auth().post('/api/v1/departments').send({ name });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const renamed = await auth().patch(`/api/v1/departments/${id}`).send({ name: `${name}-renamed` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe(`${name}-renamed`);

    const listed = await auth().get('/api/v1/departments');
    expect(listed.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, name: `${name}-renamed` })]),
    );

    const deleted = await auth().delete(`/api/v1/departments/${id}`);
    expect(deleted.status).toBe(200);

    const afterDelete = await auth().get('/api/v1/departments');
    expect(afterDelete.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id })]),
    );
  });
});
