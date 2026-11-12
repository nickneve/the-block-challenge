import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { AuctionUpdate, MyBidStatus, VehicleSummary } from './api/models';

export type LiveConnection = 'connecting' | 'live' | 'offline';

/** Messages between this app's tabs. Each carries the stream position, so any tab can take over from there. */
type TabMessage =
  | { type: 'update'; update: AuctionUpdate; eventId: string | null }
  | { type: 'connection'; state: LiveConnection; eventId: string | null }
  | { type: 'resync'; eventId: string | null }
  | { type: 'position'; eventId: string | null }
  /** A new tab asking the tab that holds the stream how it's doing. */
  | { type: 'hello' };

export const LIVE_CHANNEL = 'the-block.live';
export const LIVE_LOCK = 'the-block.live-stream';
export const LIVE_URL = '/api/events';
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Live auction updates: every bid, Buy Now and close anywhere is pushed here,
 * and views subscribe and merge updates into what they're showing.
 *
 * One stream for the whole browser, not one per tab. Over HTTP/1.1 a browser
 * keeps about six connections per site, and every EventSource holds one open,
 * so a dealer with six lots open in tabs would find the next tab never loads.
 * Instead, whichever tab holds a Web Lock opens the stream and relays it to the
 * other tabs over a BroadcastChannel. When that tab closes, the browser hands
 * the lock (and the stream) to another tab. Browsers without these APIs fall
 * back to a stream per tab.
 *
 * Nothing is lost when the connection drops:
 * - Every event has an id. EventSource reconnects on its own and sends the last id
 *   it saw, and the server first replays what was missed.
 * - A new stream (another tab taking over, or a retry after the browser gave up on
 *   one) passes the last id as `?since=`.
 * - If the server can no longer replay (it restarted, or the gap is too long), it
 *   sends `resync` and `resync$` fires, so views reload from the API.
 */
@Injectable({ providedIn: 'root' })
export class LiveAuctionService {
  private readonly updatesSubject = new Subject<AuctionUpdate>();
  private readonly resyncSubject = new Subject<void>();
  private source?: EventSource;
  private channel?: BroadcastChannel;
  private releaseLock?: () => void;
  private waitingForLock?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = RETRY_MIN_MS;
  private started = false;
  /** True in the one tab that holds the stream. */
  private leading = false;
  /** The id of the last event this browser saw, from the stream or relayed by the leading tab. */
  private lastEventId: string | null = null;

  readonly updates$: Observable<AuctionUpdate> = this.updatesSubject.asObservable();
  /** Fires when updates were missed and couldn't be replayed: reload what's on screen. */
  readonly resync$: Observable<void> = this.resyncSubject.asObservable();
  readonly connection = signal<LiveConnection>('connecting');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  connect(): void {
    if (this.started || typeof EventSource === 'undefined') return;
    this.started = true;

    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks || typeof BroadcastChannel === 'undefined') {
      this.openStream();
      return;
    }

    this.channel = new BroadcastChannel(LIVE_CHANNEL);
    this.channel.onmessage = ({ data }: MessageEvent<TabMessage>) => this.onTabMessage(data);
    this.channel.postMessage({ type: 'hello' } satisfies TabMessage);

    // Held until this tab closes (or the app is torn down); then another tab takes over.
    this.waitingForLock = new AbortController();
    locks
      .request(LIVE_LOCK, { signal: this.waitingForLock.signal }, () => {
        this.leading = true;
        this.openStream();
        return new Promise<void>((resolve) => (this.releaseLock = resolve));
      })
      .catch(() => undefined); // aborted by disconnect() while another tab held the stream
  }

  disconnect(): void {
    this.started = false;
    this.leading = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.waitingForLock?.abort();
    this.waitingForLock = undefined;
    this.source?.close();
    this.source = undefined;
    this.channel?.close();
    this.channel = undefined;
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private openStream(): void {
    const url = this.lastEventId ? `${LIVE_URL}?since=${encodeURIComponent(this.lastEventId)}` : LIVE_URL;
    const source = new EventSource(url);
    source.onopen = () => {
      this.retryDelay = RETRY_MIN_MS;
      this.setConnection('live');
    };
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) {
        this.setConnection('connecting'); // the browser is already retrying, with Last-Event-ID
        return;
      }
      // The browser gave up (e.g. the server answered with an error while restarting): retry ourselves.
      this.setConnection('offline');
      this.scheduleReopen();
    };

    source.addEventListener('auction.updated', (event) => {
      const message = event as MessageEvent<string>;
      this.track(message);
      const update = JSON.parse(message.data) as AuctionUpdate;
      this.updatesSubject.next(update);
      this.relay({ type: 'update', update, eventId: this.lastEventId });
    });
    source.addEventListener('resync', (event) => {
      this.track(event as MessageEvent<string>);
      this.resyncSubject.next();
      this.relay({ type: 'resync', eventId: this.lastEventId });
    });
    for (const type of ['ready', 'ping']) {
      source.addEventListener(type, (event) => {
        this.track(event as MessageEvent<string>);
        this.relay({ type: 'position', eventId: this.lastEventId });
      });
    }
    this.source = source;
  }

  private scheduleReopen(): void {
    this.source?.close();
    this.source = undefined;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.started && (this.leading || !this.channel)) this.openStream();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  private track(event: MessageEvent<string>): void {
    if (event.lastEventId) this.lastEventId = event.lastEventId;
  }

  private setConnection(state: LiveConnection): void {
    this.connection.set(state);
    this.relay({ type: 'connection', state, eventId: this.lastEventId });
  }

  private relay(message: TabMessage): void {
    if (this.leading) this.channel?.postMessage(message);
  }

  private onTabMessage(message: TabMessage): void {
    if (message.type === 'hello') {
      this.relay({ type: 'connection', state: this.connection(), eventId: this.lastEventId });
      return;
    }
    if (this.leading) return;
    if (message.eventId) this.lastEventId = message.eventId;
    switch (message.type) {
      case 'update':
        this.updatesSubject.next(message.update);
        break;
      case 'connection':
        this.connection.set(message.state);
        break;
      case 'resync':
        this.resyncSubject.next();
        break;
    }
  }
}

/**
 * Applies a broadcast update to a vehicle the client is holding, re-deriving
 * "my" status from the public high-bidder handle (raw bidder ids are never sent).
 */
export function applyAuctionUpdate<T extends VehicleSummary>(vehicle: T, update: AuctionUpdate, myHandle: string | null): T {
  if (vehicle.id !== update.vehicleId) return vehicle;
  return {
    ...vehicle,
    auction: update.auction,
    myStatus: deriveMyStatus(vehicle.myMaxBid, update.auction, myHandle),
  };
}

export function deriveMyStatus(
  myMaxBid: number | null,
  auction: VehicleSummary['auction'],
  myHandle: string | null,
): MyBidStatus | null {
  if (myMaxBid === null) return null;
  const leading = myHandle !== null && auction.highBidderHandle === myHandle;
  if (auction.status === 'open') return leading ? 'winning' : 'outbid';
  return leading && auction.outcome === 'sold' ? 'won' : 'lost';
}
