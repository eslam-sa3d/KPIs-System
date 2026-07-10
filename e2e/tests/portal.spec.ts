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
    await page.getByLabel('form title').fill(formTitle);
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
