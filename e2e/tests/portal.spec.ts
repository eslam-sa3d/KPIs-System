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
    // .form-error, not getByRole('alert') — Next's route announcer is also role=alert
    await expect(page.locator('.form-error')).toContainText(/invalid/i);
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
    await page.getByLabel('form title').fill(formTitle);
    await page.getByRole('button', { name: 'add field' }).click();
    await page.getByLabel('field label').fill('Team');
    await page.locator('.field-type-summary').first().click();
    await page.getByRole('option', { name: 'short text' }).click();
    await page.getByLabel('required').check();
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
    await page.getByRole('button', { name: 'create', exact: true }).click();
    await expect(page.getByRole('heading', { name: kpiName, exact: true })).toBeVisible();

    // add an evaluation area under it
    await page.getByRole('button', { name: 'add evaluation area' }).click();
    await page.getByLabel('new area name').fill(areaName);
    await page.getByRole('button', { name: 'add', exact: true }).click();
    await expect(page.getByText(areaName)).toBeVisible();

    // build a form with a "person" field (the evaluatee) and a "rating"
    // field (the score) — the Forms→KPI bridge scores an Evaluation Area
    // from these two fields on every submission, there's no direct
    // record-a-score control on the KPI page itself any more.
    await page.goto('/forms/new');
    await page.getByLabel('form title').fill(formTitle);

    await page.getByRole('button', { name: 'add field' }).click();
    const whoField = page.locator('.builder-field').nth(0);
    await whoField.getByLabel('field label').fill('Who');
    await whoField.locator('.field-type-summary').click();
    await page.getByRole('option', { name: 'person' }).click();

    await page.getByRole('button', { name: 'add field' }).click();
    const scoreField = page.locator('.builder-field').nth(1);
    await scoreField.getByLabel('field label').fill('Score');
    await scoreField.locator('.field-type-summary').click();
    await page.getByRole('option', { name: 'rating' }).click();

    await page.getByRole('button', { name: 'publish' }).click();
    await expect(page.getByText(/published/i)).toBeVisible();
    await page.getByRole('link', { name: 'open form' }).click();

    // map "Who"/"Score" to the evaluation area we just created
    await page.getByRole('tab', { name: 'settings' }).click();
    await page.getByLabel('add a mapping').selectOption({ label: kpiName });
    await page.getByLabel('evaluation area').selectOption({ label: areaName });
    await page.getByLabel('evaluatee field').selectOption({ label: 'Who' });
    await page.getByLabel('score field').selectOption({ label: 'Score' });
    await page.getByRole('button', { name: 'add mapping' }).click();
    await expect(page.getByText(/no KPI mapping yet/i)).toHaveCount(0);

    // submit the form for the admin's own account (a real, always-present user)
    await page.getByRole('tab', { name: 'form' }).click();
    await page.getByLabel('Who search').fill(ADMIN.email.split('@')[0]!);
    await page.getByLabel('Who matches').selectOption({ index: 1 });
    await page.getByLabel('Score').getByRole('radio', { name: '4', exact: true }).click();
    await page.getByRole('button', { name: 'submit' }).click();
    await expect(page.getByText(/thank you/i)).toBeVisible();

    // the dashboard's "KPI by Person" chart and table both derive from the
    // EvaluationAreaEntry that submission just upserted — the table row is
    // the more stable thing to assert on
    await page.goto('/dashboard');
    await expect(page.getByRole('cell', { name: kpiName })).toBeVisible();
  });
});
