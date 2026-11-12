import { TestBed } from '@angular/core/testing';
import { AuctionState, AuctionUpdate, VehicleSummary } from './api/models';
import { applyAuctionUpdate, deriveMyStatus, LiveAuctionService } from './live-auction.service';

const auction = (overrides: Partial<AuctionState> = {}): AuctionState => ({
  status: 'open',
  outcome: null,
  closesAt: '2026-11-05T12:00:00.000Z',
  extended: false,
  startingBid: 10_000,
  currentBid: 12_000,
  bidCount: 4,
  minNextBid: 12_250,
  bidIncrement: 250,
  maxAllowedBid: 36_750,
  reserveStatus: 'not_met',
  buyNowPrice: null,
  buyNowAvailable: false,
  soldViaBuyNow: false,
  highBidderHandle: 'Bidder 1111',
  ...overrides,
});

describe('deriveMyStatus', () => {
  it('is null for lots the buyer never bid on', () => {
    expect(deriveMyStatus(null, auction(), 'Bidder 1111')).toBeNull();
  });

  it('is winning or outbid while open', () => {
    expect(deriveMyStatus(12_000, auction(), 'Bidder 1111')).toBe('winning');
    expect(deriveMyStatus(11_500, auction(), 'Bidder 2222')).toBe('outbid');
  });

  it('is won only if the buyer led and the lot sold', () => {
    const sold = auction({ status: 'ended', outcome: 'sold' });
    const unsold = auction({ status: 'ended', outcome: 'reserve_not_met' });
    expect(deriveMyStatus(12_000, sold, 'Bidder 1111')).toBe('won');
    expect(deriveMyStatus(12_000, unsold, 'Bidder 1111')).toBe('lost');
    expect(deriveMyStatus(11_500, sold, 'Bidder 2222')).toBe('lost');
  });
});

describe('applyAuctionUpdate', () => {
  const vehicle = { id: 'v1', myMaxBid: 12_000, myStatus: 'winning', auction: auction() } as VehicleSummary;
  const update: AuctionUpdate = {
    vehicleId: 'v1',
    reason: 'bid',
    auction: auction({ currentBid: 12_250, highBidderHandle: 'Bidder 9999', bidCount: 5 }),
    lastBid: { amount: 12_250, bidderHandle: 'Bidder 9999', placedAt: '2026-11-04T12:00:00.000Z', kind: 'bid' },
  };

  it('replaces the auction state and flips the buyer to outbid', () => {
    const next = applyAuctionUpdate(vehicle, update, 'Bidder 1111');
    expect(next.auction.currentBid).toBe(12_250);
    expect(next.myStatus).toBe('outbid');
  });

  it('leaves other vehicles untouched', () => {
    const other = { ...vehicle, id: 'v2' };
    expect(applyAuctionUpdate(other, update, 'Bidder 1111')).toBe(other);
  });
});

describe('LiveAuctionService across tabs', () => {
  /** Stands in for the browser's EventSource; records every stream opened. */
  class FakeEventSource {
    static readonly CLOSED = 2;
    static opened: FakeEventSource[] = [];
    readyState = 0;
    closed = false;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

    constructor(readonly url: string) {
      FakeEventSource.opened.push(this);
    }
    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
      this.listeners.set(type, listener);
    }
    close(): void {
      this.closed = true;
    }
    emit(type: string, data: unknown, lastEventId = ''): void {
      this.listeners.get(type)?.({ data: JSON.stringify(data), lastEventId } as MessageEvent<string>);
    }
    push(update: AuctionUpdate, lastEventId = ''): void {
      this.emit('auction.updated', update, lastEventId);
    }
    /** The browser giving up on the stream (it does this after an HTTP error, for example). */
    fail(): void {
      this.readyState = FakeEventSource.CLOSED;
      this.onerror?.();
    }
  }

  /** Same-origin channels: a message reaches every other open channel with the same name. */
  class FakeChannel {
    static open: FakeChannel[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(readonly name: string) {
      FakeChannel.open.push(this);
    }
    postMessage(data: unknown): void {
      for (const other of FakeChannel.open) {
        if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
      }
    }
    close(): void {
      FakeChannel.open = FakeChannel.open.filter((channel) => channel !== this);
    }
  }

  /** One exclusive lock, granted in request order and released when the holder's promise settles. */
  const fakeLocks = () => {
    let held = false;
    const queue: (() => void)[] = [];
    return {
      request(_name: string, options: { signal?: AbortSignal }, callback: () => Promise<void> | void) {
        return new Promise<void>((resolve, reject) => {
          const run = () => {
            held = true;
            Promise.resolve(callback())
              .then(resolve)
              .finally(() => {
                held = false;
                queue.shift()?.();
              });
          };
          options.signal?.addEventListener('abort', () => {
            const index = queue.indexOf(run);
            if (index >= 0) {
              queue.splice(index, 1);
              reject(new DOMException('Aborted', 'AbortError'));
            }
          });
          if (held) queue.push(run);
          else run();
        });
      },
    };
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { EventSource: globals['EventSource'], BroadcastChannel: globals['BroadcastChannel'] };
  const settle = () => new Promise((resolve) => setTimeout(resolve));
  const tab = () => TestBed.runInInjectionContext(() => new LiveAuctionService());
  const update = (vehicleId: string): AuctionUpdate => ({ vehicleId, reason: 'bid', auction: auction(), lastBid: null });

  beforeEach(() => {
    FakeEventSource.opened = [];
    FakeChannel.open = [];
    globals['EventSource'] = FakeEventSource;
    globals['BroadcastChannel'] = FakeChannel;
    Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true });
  });

  afterEach(() => {
    globals['EventSource'] = saved.EventSource;
    globals['BroadcastChannel'] = saved.BroadcastChannel;
    delete (navigator as unknown as Record<string, unknown>)['locks'];
    TestBed.resetTestingModule();
  });

  it('opens one stream for every tab and relays updates to the others', () => {
    const first = tab();
    const second = tab();
    const seen: string[] = [];
    first.updates$.subscribe((u) => seen.push(`first:${u.vehicleId}`));
    second.updates$.subscribe((u) => seen.push(`second:${u.vehicleId}`));

    first.connect();
    second.connect();
    expect(FakeEventSource.opened.length).toBe(1);

    FakeEventSource.opened[0].onopen?.();
    expect(second.connection()).toBe('live');

    FakeEventSource.opened[0].push(update('v1'));
    expect(seen).toEqual(['first:v1', 'second:v1']);
  });

  it('hands the stream to another tab when the one holding it closes', async () => {
    const first = tab();
    const second = tab();
    first.connect();
    second.connect();

    first.disconnect();
    await settle();

    expect(FakeEventSource.opened.length).toBe(2);
    expect(FakeEventSource.opened[0].closed).toBe(true);
    const seen: string[] = [];
    second.updates$.subscribe((u) => seen.push(u.vehicleId));
    FakeEventSource.opened[1].push(update('v2'));
    expect(seen).toEqual(['v2']);
  });

  it('starts a taken-over stream from the last event the new tab saw, so nothing is missed', async () => {
    const first = tab();
    const second = tab();
    first.connect();
    second.connect();
    FakeEventSource.opened[0].push(update('v1'), 'abc:7');

    first.disconnect();
    await settle();

    expect(FakeEventSource.opened[1].url).toBe('/api/events?since=abc%3A7');
  });

  it('passes a resync from the server to every tab', () => {
    const first = tab();
    const second = tab();
    let resyncs = 0;
    first.resync$.subscribe(() => resyncs++);
    second.resync$.subscribe(() => resyncs++);
    first.connect();
    second.connect();

    FakeEventSource.opened[0].emit('resync', {}, 'abc:9');
    expect(resyncs).toBe(2);
  });

  it('reopens a stream the browser gave up on, from the last event, backing off between tries', () => {
    vi.useFakeTimers();
    try {
      const only = tab();
      only.connect();
      FakeEventSource.opened[0].emit('ready', {}, 'abc:3');

      FakeEventSource.opened[0].fail();
      expect(only.connection()).toBe('offline');
      expect(FakeEventSource.opened[0].closed).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(FakeEventSource.opened.length).toBe(2);
      expect(FakeEventSource.opened[1].url).toBe('/api/events?since=abc%3A3');

      FakeEventSource.opened[1].fail();
      vi.advanceTimersByTime(1000);
      expect(FakeEventSource.opened.length).toBe(2); // waits twice as long the second time
      vi.advanceTimersByTime(1000);
      expect(FakeEventSource.opened.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
