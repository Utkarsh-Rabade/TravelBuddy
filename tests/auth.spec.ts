import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should allow user to navigate to sign-in page', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await expect(page).toHaveURL('/auth/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  });

  test('should allow user to navigate to sign-up page', async ({ page }) => {
    await page.goto('/auth/sign-up');
    await expect(page).toHaveURL('/auth/sign-up');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByLabel('Confirm password')).toBeVisible();
  });

  test('should have a home page with TravelBuddy title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('TravelBuddy');
    await expect(page.getByText('TravelBuddy', { exact: true }).first()).toBeVisible();
  });
});
