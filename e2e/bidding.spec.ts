import { expect, test } from '@playwright/test';

test.describe('Bidding', () => {
  test('a guest is asked to sign in, confirms, and becomes the high bidder', async ({ page }) => {
    await page.goto('/');
    await page.locator('app-vehicle-card a').first().click();
    await expect(page).toHaveURL(/\/vehicles\//);

    await page.getByRole('button', { name: /^Place bid · / }).click();

    const signIn = page.getByRole('dialog', { name: /^Sign in to / });
    await signIn.getByLabel('Work email').fill('buyer@dealership.ca');
    await signIn.getByLabel('Password', { exact: true }).fill('correct-horse-1');
    await signIn.locator('button[type="submit"]').click();

    const confirm = page.getByRole('dialog', { name: 'Confirm your bid' });
    await expect(confirm.getByText('How will you pay if you win?')).toBeVisible();
    await confirm.getByRole('button', { name: /^Place bid · / }).click();

    await expect(confirm).toBeHidden();
    await expect(page.getByRole('region', { name: 'Bidding' }).getByText("You're the high bidder")).toBeVisible();
    await expect(page.getByRole('link', { name: /My bids/ }).first()).toBeVisible();
  });
});
