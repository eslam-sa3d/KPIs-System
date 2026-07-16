import { expect, test } from '@playwright/test';

const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@pulse.local',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026',
};

test.describe('branded landing page', () => {
  test('shows brand identity and routes to login', async ({ page }) => {
    await page.goto('/');
    // header + footer both carry the logo — assert the first
    await expect(page.getByAltText('pulse by solutions').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /digital apps/i })).toBeVisible();

    await page.getByRole('link', { name: 'sign in' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('login gateway', () => {
  test('rejects invalid credentials with a friendly error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('email').fill(ADMIN.email);
    await page.getByLabel('password').fill('wrong-password');
    await page.getByRole('button', { name: 'sign in' }).click();
    // [data-slot="alert"] (the shadcn Alert), not getByRole('alert') — Next's
    // route announcer is also role=alert, and Alert itself sets role="alert" too
    await expect(page.locator('[data-slot="alert"]')).toContainText(/invalid/i);
  });

  test('signs in and lands on the role-scoped dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('email').fill(ADMIN.email);
    await page.getByLabel('password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

test.describe('form builder → submission → list (happy path)', () => {
  test('admin builds a form, submits an entry, sees it in the table', async ({ page }, testInfo) => {
    // unique per browser-project run — parallel projects share one database
    const formTitle = `e2e sprint check ${testInfo.project.name} ${Date.now()}`;

    // login
    await page.goto('/login');
    await page.getByLabel('email').fill(ADMIN.email);
    await page.getByLabel('password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // build — the type selector is a custom listbox (not a native <select>),
    // and a newly-added field auto-expands, so its "field label"/"required"
    // controls are visible without an extra click.
    await page.goto('/forms/new');
    // WebKit under dev-mode hydration can be slow enough that an immediate
    // .fill() lands before React attaches its onChange handler, so the value
    // gets silently dropped on hydration — wait for the network (and thus
    // the client bundle) to settle before interacting with anything.
    await page.waitForLoadState('networkidle');
    const titleInput = page.getByLabel('form title');
    await titleInput.waitFor({ state: 'visible' });
    await expect(titleInput).toBeEnabled();
    await titleInput.fill(formTitle);
    await expect(titleInput).toHaveValue(formTitle);
    await page.getByRole('button', { name: 'add field' }).click();
    await page.getByLabel('field label').fill('Team');
    await page.locator('.field-type-summary').first().click();
    await page.getByRole('menuitem', { name: 'short text' }).click();
    await page.getByLabel('required').click();
    await page.getByRole('button', { name: 'publish' }).click();
    await expect(page.getByText(/published/i)).toBeVisible();

    // submit
    await page.getByRole('link', { name: 'open form' }).click();
    await page.getByLabel('Team').fill('digital-channels');
    await page.getByRole('button', { name: 'submit' }).click();
    await expect(page.getByText(/thank you/i)).toBeVisible();

    // verify in submissions table — exact: the row's "edit" icon-link's own
    // aria-label embeds the same title text, which would otherwise also match
    await page.goto('/forms');
    await page.getByRole('link', { name: formTitle, exact: true }).click();
    await page.getByRole('tab', { name: 'submissions' }).click();
    await expect(page.getByRole('cell', { name: 'digital-channels' })).toBeVisible();
  });
});

test.describe('KPI module (create → evaluation area → score via a mapped form → dashboard)', () => {
  test('admin creates a KPI + area, maps a form to it, and a submission scores it on the dashboard', async ({
    page,
  }, testInfo) => {
    // unique per browser-project run — parallel projects share one database
    const suffix = `${testInfo.project.name} ${Date.now()}`;
    const kpiName = `e2e KPI ${suffix}`;
    const areaName = `e2e area ${suffix}`;
    const formTitle = `e2e scoring form ${suffix}`;

    await page.goto('/login');
    await page.getByLabel('email').fill(ADMIN.email);
    await page.getByLabel('password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // create the KPI — it auto-selects into the detail pane once created
    await page.goto('/admin/kpis');
    await page.getByRole('button', { name: 'new KPI' }).click();
    await page.getByLabel('KPI name').fill(kpiName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: kpiName, exact: true })).toBeVisible();

    // /v1/kpis/my (what the dashboard reads) unconditionally filters to KPIs
    // assigned to one of the caller's roles/department — even for an admin —
    // so the freshly-created KPI needs a role assignment before it can show
    // up there. Drive the admin/kpis "Assign to role" control directly.
    await page.getByRole('button', { name: 'Assign to role' }).click();
    const roleAssignForm = page.locator('.inline-form').filter({ has: page.getByLabel('Assign to role') });
    await page.getByLabel('Assign to role').click();
    await page.getByRole('option', { name: 'admin', exact: true }).click();
    await roleAssignForm.getByRole('button', { name: 'Assign', exact: true }).click();
    await roleAssignForm.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('button', { name: 'Remove admin assignment' })).toBeVisible();

    // add an evaluation area under it
    await page.getByRole('button', { name: 'add evaluation area' }).click();
    await page.getByLabel('new area name').fill(areaName);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(areaName)).toBeVisible();

    // build a form with a "rating" field (the score) — a KPI mapping with no
    // evaluatee field is a self-assessment: the submitter scores themselves,
    // no "person" field needed. There's no direct record-a-score control on
    // the KPI page itself any more.
    await page.goto('/forms/new');
    // WebKit under dev-mode hydration can be slow enough that an immediate
    // .fill() lands before React attaches its onChange handler, so the value
    // gets silently dropped on hydration — wait for the network (and thus
    // the client bundle) to settle before interacting with anything.
    await page.waitForLoadState('networkidle');
    const titleInput = page.getByLabel('form title');
    await titleInput.waitFor({ state: 'visible' });
    await expect(titleInput).toBeEnabled();
    await titleInput.fill(formTitle);
    await expect(titleInput).toHaveValue(formTitle);

    await page.getByRole('button', { name: 'add field' }).click();
    const scoreField = page.locator('.builder-field').nth(0);
    await scoreField.getByLabel('field label').fill('Score');
    await scoreField.locator('.field-type-summary').click();
    await page.getByRole('menuitem', { name: 'rating' }).click();

    await page.getByRole('button', { name: 'publish' }).click();
    await expect(page.getByText(/published/i)).toBeVisible();
    await page.getByRole('link', { name: 'open form' }).click();

    // map "Score" to the evaluation area we just created — self-assessment, no evaluatee field.
    // The Settings tab's "KPI scoring" mapping panel is currently hidden from this page (temporary
    // product decision), so create the mapping directly against the API instead of driving that UI.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const accessToken: string = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' });
      const envelope = await res.json();
      return envelope.data.accessToken;
    }, apiUrl);
    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    const formsEnvelope = await (await page.request.get(`${apiUrl}/api/v1/forms`, { headers: authHeaders })).json();
    const targetForm = (formsEnvelope.data as Array<{ id: string; slug: string; title: string }>).find(
      (f) => f.title === formTitle,
    )!;
    const formDetailEnvelope = await (
      await page.request.get(`${apiUrl}/api/v1/forms/${targetForm.slug}`, { headers: authHeaders })
    ).json();
    const scoreFieldDef = (
      formDetailEnvelope.data.definition.fields as Array<{ key: string; label: string }>
    ).find((f) => f.label === 'Score')!;

    const kpisEnvelope = await (
      await page.request.get(`${apiUrl}/api/v1/kpis?pageSize=100`, { headers: authHeaders })
    ).json();
    const kpi = (
      kpisEnvelope.data as Array<{ name: string; evaluationAreas: Array<{ id: string; name: string }> }>
    ).find((k) => k.name === kpiName)!;
    const area = kpi.evaluationAreas.find((a) => a.name === areaName)!;

    await page.request.post(`${apiUrl}/api/v1/forms/${targetForm.id}/kpi-mappings`, {
      headers: authHeaders,
      data: { evaluationAreaId: area.id, scoreFieldKey: scoreFieldDef.key },
    });

    // submit the form for the admin's own account — self-assessment scores the submitter
    await page.getByRole('tab', { name: 'form' }).click();
    await page.getByLabel('Score').getByRole('radio', { name: '4', exact: true }).click();
    await page.getByRole('button', { name: 'submit' }).click();
    await expect(page.getByText(/thank you/i)).toBeVisible();

    // the dashboard no longer lists individual KPIs (that per-KPI table was
    // removed) — the team members table's blended score is now the stable,
    // still-visible thing this submission's EvaluationAreaEntry feeds into.
    await page.goto('/dashboard');
    const adminRow = page.getByRole('button', { name: "view Platform Admin's rate" });
    await expect(adminRow.getByText(/\d(\.\d)? \/ 5/)).toBeVisible();
  });
});
