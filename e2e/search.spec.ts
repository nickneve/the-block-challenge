import { expect, test } from '@playwright/test';

/** Longer than the search box's 300 ms pause, so a search still waiting would have run by now. */
const PAST_DEBOUNCE_MS = 800;

test.describe('Search', () => {
  test('typing searches, and the URL follows', async ({ page }) => {
    await page.goto('/');
    // "bronco" only matches the model ("ford" would also match the Parkway Ford dealership).
    await page.getByRole('searchbox', { name: 'Search vehicles' }).fill('bronco');

    await expect(page).toHaveURL(/[?&]q=bronco/);
    await expect(page.getByRole('button', { name: /^Remove filter: .*bronco/i })).toBeVisible();
    const titles = page.locator('app-vehicle-card h3');
    await expect(titles.first()).toContainText('Ford Bronco');
    for (const title of await titles.allTextContents()) expect(title).toContain('Bronco');
  });

  test('clearing a search straight after typing does not bring it back', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Search vehicles' });

    await search.fill('ford');
    await page.getByRole('button', { name: 'Clear search' }).click(); // inside the pause

    await page.waitForTimeout(PAST_DEBOUNCE_MS);
    await expect(search).toHaveValue('');
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  });

  test('removing the search chip while more typing is pending does not bring it back', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Search vehicles' });
    await search.fill('ford');
    await expect(page).toHaveURL(/[?&]q=ford/);

    await search.fill('ford f-150');
    await page.getByRole('button', { name: /^Remove filter: .*ford/i }).click(); // inside the pause

    await page.waitForTimeout(PAST_DEBOUNCE_MS);
    await expect(search).toHaveValue('');
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  });

  test('Back from a vehicle restores the search, in the box and the URL', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Search vehicles' });
    await search.fill('ford');
    await expect(page).toHaveURL(/[?&]q=ford/);
    await page.locator('app-vehicle-card a').first().click();
    await expect(page).toHaveURL(/\/vehicles\//);

    await page.goBack();
    await expect(search).toHaveValue('ford');
    await expect(page).toHaveURL(/[?&]q=ford/);
  });
});
