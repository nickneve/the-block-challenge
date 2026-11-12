import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { map, Observable, Subject } from 'rxjs';
import { VehicleRow } from '../vehicles/vehicle-row';

/**
 * Internal event, carrying raw rows and bidder ids. The SSE controller maps it
 * to a public payload before anything leaves the server.
 */
export interface AuctionChange {
  vehicleId: string;
  reason: 'bid' | 'buy_now' | 'closed';
  row: VehicleRow;
  lastBid: {
    amount: number;
    bidderId: string;
    placedAt: number;
    kind: 'bid' | 'buy_now';
    source: 'user' | 'sim';
  } | null;
}

/** A change with its place in the stream. */
export interface SequencedChange {
  seq: number;
  change: AuctionChange;
}

/** What a reconnecting client gets: the changes it missed, or "resync" when they're gone. */
export type Catchup = { kind: 'replay'; changes: SequencedChange[] } | { kind: 'resync' };

/** About an hour of changes with rival bidding on; a client gone longer reloads instead. */
export const REPLAY_BUFFER_SIZE = 1000;

/**
 * In-process pub/sub for auction state changes.
 *
 * Every change gets a sequence number, and the most recent ones are kept so a client
 * whose connection dropped can say "I last saw X" and be sent what it missed. Event ids
 * start with an id for this process, so an id from before a restart (when the buffer
 * was lost) is recognised and the client is told to resync instead.
 */
@Injectable()
export class AuctionEventsService {
  readonly streamId = randomUUID().slice(0, 8);
  private seq = 0;
  private readonly recent: SequencedChange[] = [];
  private readonly changes = new Subject<SequencedChange>();

  readonly sequenced$: Observable<SequencedChange> = this.changes.asObservable();
  readonly changes$: Observable<AuctionChange> = this.sequenced$.pipe(map((entry) => entry.change));

  publish(change: AuctionChange): void {
    const entry = { seq: ++this.seq, change };
    this.recent.push(entry);
    if (this.recent.length > REPLAY_BUFFER_SIZE) this.recent.shift();
    this.changes.next(entry);
  }

  eventId(seq: number): string {
    return `${this.streamId}:${seq}`;
  }

  /** The id of the latest change: where a client is once it has seen everything so far. */
  cursor(): string {
    return this.eventId(this.seq);
  }

  /** What a client that last saw `lastEventId` has missed. No id means a fresh client: nothing. */
  since(lastEventId: string | undefined): Catchup {
    if (!lastEventId) return { kind: 'replay', changes: [] };

    const [stream, raw] = lastEventId.split(':');
    const seq = Number(raw);
    if (stream !== this.streamId || !Number.isInteger(seq) || seq < 0 || seq > this.seq) {
      return { kind: 'resync' };
    }
    const oldest = this.recent[0]?.seq ?? this.seq + 1;
    if (seq < oldest - 1) return { kind: 'resync' };
    return { kind: 'replay', changes: this.recent.filter((entry) => entry.seq > seq) };
  }
}
