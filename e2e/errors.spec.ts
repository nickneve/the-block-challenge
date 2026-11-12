import { expect, test } from '@playwright/test';

const unavailable = { status: 503, contentType: 'application/json', body: '{"code":"UNAVAILABLE","message":"Down"}' };

test.describe('Failures show as failures, not as empty data', () => {
  test('My bids says it could not load, and Try again recovers', async ({ page }) => {
    await page.route('**/api/me/bids', (route) => route.fulfill(unavailable));
    await page.goto('/my-bids');

    await expect(page.getByRole('alert').getByText('Your bids didn’t load')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No active bids' })).toHaveCount(0);

    await page.unroute('**/api/me/bids');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'No active bids' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the watchlist tab says it could not load', async ({ page }) => {
    await page.route('**/api/me/watchlist', (route) => route.fulfill(unavailable));
    await page.goto('/my-bids?tab=watchlist');

    await expect(page.getByRole('alert').getByText('Your watchlist didn’t load')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nothing on your watchlist' })).toHaveCount(0);
  });

  test('Saved searches says it could not load, and Try again recovers', async ({ page }) => {
    await page.route('**/api/me/saved-searches', (route) => route.fulfill(unavailable));
    await page.goto('/saved-searches');

    await expect(page.getByRole('alert').getByText('Your saved searches didn’t load')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No saved searches yet' })).toHaveCount(0);

    await page.unroute('**/api/me/saved-searches');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'No saved searches yet' })).toBeVisible();
  });
});
