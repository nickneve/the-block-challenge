import { expect, test } from '@playwright/test';
import { bidAsOtherDealer, gotoLive, grouped, openLots, priceOf } from './helpers';

test.describe('Live updates', () => {
  test("another dealer's bid shows on the vehicle page without a reload", async ({ page, request }) => {
    const [lot] = await openLots(request, 'sort=closing');
    await gotoLive(page, `/vehicles/${lot.id}`);
    const price = page.locator('app-bid-panel .price');
    await expect(price).toContainText(grouped(priceOf(lot)));

    await bidAsOtherDealer(request, lot.id, lot.auction.minNextBid);

    await expect(price).toContainText(grouped(lot.auction.minNextBid));
  });

  test('a lot that a live bid prices out of the filter leaves the results, and the count follows', async ({ page, request }) => {
    // The most expensive open lot under $20,000, then a filter of "under its current price".
    const lot = (await openLots(request, 'sort=price_desc&priceMax=20000'))[0];
    const price = priceOf(lot);
    await gotoLive(page, `/?priceMax=${price}&sort=price_desc`);

    const card = page.locator(`app-vehicle-card a[href="/vehicles/${lot.id}"]`);
    const count = page.locator('.result-count strong');
    await expect(card).toBeVisible();
    const before = Number(await count.textContent());

    await bidAsOtherDealer(request, lot.id, lot.auction.minNextBid); // now above the filter's limit

    await expect(card).toHaveCount(0);
    await expect(count).toHaveText(String(before - 1));
  });

  test('a price sort reorders when a live bid moves a lot to the top', async ({ page, request }) => {
    const lots = await openLots(request, 'sort=price_desc');
    const leader = lots[0];
    const amount = priceOf(leader) + 1000;
    const challenger = lots.find(
      (lot) => lot.id !== leader.id && lot.auction.minNextBid <= amount && lot.auction.maxAllowedBid >= amount,
    );
    test.skip(!challenger, 'No lot can be bid past the dearest one in a single valid bid.');

    await gotoLive(page, '/?sort=price_desc');
    const first = page.locator('app-vehicle-card a').first();
    await expect(first).toHaveAttribute('href', `/vehicles/${leader.id}`);

    await bidAsOtherDealer(request, challenger!.id, amount);

    await expect(first).toHaveAttribute('href', `/vehicles/${challenger!.id}`);
  });
});
