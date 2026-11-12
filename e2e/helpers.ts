import { type APIRequestContext, expect, type Page } from '@playwright/test';

export interface Lot {
  id: string;
  year: number;
  make: string;
  model: string;
  auction: { status: string; currentBid: number | null; startingBid: number; minNextBid: number; maxAllowedBid: number };
}

/** A second dealer, bidding straight through the API (ids starting "rival-" are reserved for the simulator). */
const OTHER_DEALER = 'e2e-other-dealer-0001';

export async function openLots(request: APIRequestContext, query = ''): Promise<Lot[]> {
  const response = await request.get(`/api/vehicles?pageSize=100${query ? `&${query}` : ''}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: Lot[] }).items;
}

export function priceOf(lot: Lot): number {
  return lot.auction.currentBid ?? lot.auction.startingBid;
}

export async function bidAsOtherDealer(request: APIRequestContext, lotId: string, amount: number): Promise<void> {
  const response = await request.post(`/api/vehicles/${lotId}/bids`, {
    headers: { 'X-Bidder-Id': OTHER_DEALER },
    data: { amount },
  });
  expect(response.status(), await response.text()).toBe(201);
}

/** "12,250": how the app writes an amount (inside "$12,250"). */
export function grouped(amount: number): string {
  return amount.toLocaleString('en-US');
}

/**
 * Opens a page and waits until its live stream is connected, so an update made
 * right after can't arrive before the page is listening.
 */
export async function gotoLive(page: Page, url: string): Promise<void> {
  const stream = page.waitForResponse((response) => response.url().includes('/api/events'));
  await page.goto(url);
  await stream;
}
