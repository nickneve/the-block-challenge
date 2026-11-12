import { expect, test } from '@playwright/test';

test.describe('On a phone', () => {
  test('filters open as a sheet, and the sticky bar takes you to the bid box', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('complementary', { name: 'Filters' });
    await expect(sheet).toBeInViewport();
    await sheet.getByRole('button', { name: /^Show \d+ vehicles?$/ }).click();
    await expect(sheet).not.toBeInViewport();

    await page.locator('app-vehicle-card a').first().click();
    const bar = page.getByRole('region', { name: 'Quick bid' });
    // The bar only appears once the bid panel has scrolled out of view.
    await expect(page.getByRole('button', { name: /^Place bid · / })).toBeVisible();
    await expect(bar).toHaveCount(0);
    await page.getByRole('heading', { name: 'Bid history' }).scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();

    await bar.getByRole('button', { name: 'Bid', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Place bid · / })).toBeInViewport();
  });

  test('the page never scrolls sideways', async ({ page }) => {
    for (const path of ['/', '/my-bids', '/saved-searches']) {
      await page.goto(path);
      // Not "networkidle": the live stream keeps a connection open for good.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
    }
  });
});
