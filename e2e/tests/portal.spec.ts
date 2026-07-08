import { expect, test } from '@playwright/test';

const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@pulse.local',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026',
};

test.describe('branded landing page', () => {
  test('shows brand identity and routes to login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByAltText('pulse by solutions')).toBeVisible();
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

    // build
    await page.goto('/forms/new');
    await page.getByLabel('form title').fill(formTitle);
    await page.getByRole('button', { name: 'add field' }).click();
    await page.getByLabel('field label').fill('Team');
    await page.getByLabel('field type').selectOption('short_text');
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
