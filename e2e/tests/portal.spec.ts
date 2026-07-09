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
    await expect(page.getByRole('heading', { name: 'elevating what matters' })).toBeVisible();

    await page.getByRole('link', { name: 'enter the portal' }).click();
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

    // verify in submissions table
    await page.goto('/forms');
    await page.getByRole('link', { name: formTitle }).click();
    await page.getByRole('tab', { name: 'submissions' }).click();
    await expect(page.getByRole('cell', { name: 'digital-channels' })).toBeVisible();
  });
});

test.describe('KPI module (create → evaluation area → score → dashboard)', () => {
  test('admin creates a KPI, adds an evaluation area, records a score, sees it on the dashboard', async ({
    page,
  }, testInfo) => {
    // unique per browser-project run — parallel projects share one database
    const suffix = `${testInfo.project.name} ${Date.now()}`;
    const kpiName = `e2e KPI ${suffix}`;
    const areaName = `e2e area ${suffix}`;

    await page.goto('/login');
    await page.getByLabel('email').fill(ADMIN.email);
    await page.getByLabel('password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // create the KPI — the admin/kpis page lists every existing KPI with
    // identically-named "add area"/"record score" controls per card, so
    // every interaction past this point is scoped to just this KPI's own
    // <article> to stay correct regardless of what else is already seeded.
    await page.goto('/admin/kpis');
    await page.getByLabel('name', { exact: true }).fill(kpiName);
    await page.getByRole('button', { name: 'create KPI' }).click();

    const kpiCard = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: kpiName, exact: true }) });
    await expect(kpiCard).toBeVisible();

    // map it to the admin's own role — /v1/kpis/my (what the dashboard reads)
    // only returns KPIs assigned to one of the caller's roles/department, so
    // an unmapped KPI would never appear there regardless of scoring
    await kpiCard.getByLabel(`map ${kpiName} to role`).selectOption({ label: 'admin' });
    await kpiCard.getByRole('button', { name: 'map' }).click();

    // add an evaluation area under it
    await kpiCard.getByLabel('new area name').fill(areaName);
    await kpiCard.getByRole('button', { name: 'add area' }).click();
    await expect(kpiCard.getByText(areaName)).toBeVisible();

    // record a 0-5 score for the admin's own account (a real, always-present user)
    await kpiCard.getByLabel(`who this ${areaName} score is for`).fill(ADMIN.email.split('@')[0]!);
    await kpiCard.getByLabel('matching people').selectOption({ index: 1 });
    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000); // periodEnd must be after periodStart
    await kpiCard.getByLabel(`${areaName} score`).fill('4.5');
    await kpiCard.getByLabel(`${areaName} period start`).fill(periodStart.toISOString().slice(0, 10));
    await kpiCard.getByLabel(`${areaName} period end`).fill(periodEnd.toISOString().slice(0, 10));
    await kpiCard.getByRole('button', { name: 'record score' }).click();
    await expect(page.locator('.form-error')).toHaveCount(0);

    // the dashboard's "KPI by Person" chart and table both derive from this
    // same recorded entry — the table row is the more stable thing to assert on
    await page.goto('/dashboard');
    await expect(page.getByRole('cell', { name: kpiName })).toBeVisible();
  });
});
