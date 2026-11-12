import { Controller, Headers, MessageEvent, Query, Sse } from '@nestjs/common';
import { concat, defer, from, interval, map, merge, Observable } from 'rxjs';
import { bidderHandle } from '../bidders/bidder-identity';
import { Clock } from '../common/clock';
import { AuctionUpdateDto } from '../vehicles/vehicle.dto';
import { toAuctionState } from '../vehicles/vehicle.mapper';
import { AuctionChange, AuctionEventsService, SequencedChange } from './auction-events.service';

const HEARTBEAT_MS = 25_000;

@Controller('events')
export class EventsController {
  constructor(
    private readonly events: AuctionEventsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Server-sent events: every connected tab hears every bid, buy-now and close.
   *
   * Every message carries an id. When a connection drops, the browser reconnects with
   * the last id it saw in the `Last-Event-ID` header (or a new stream passes it as
   * `?since=`), and is first sent what it missed. If those changes are no longer kept,
   * it gets a `resync` event and reloads what it's showing. `ready` marks the point
   * where the client is caught up.
   */
  @Sse()
  stream(@Headers('last-event-id') lastEventId?: string, @Query('since') since?: string): Observable<MessageEvent> {
    // Deferred so the catch-up and the live subscription happen in the same tick: nothing slips between them.
    return defer(() => {
      const catchup = this.events.since(lastEventId || since);
      const missed: MessageEvent[] =
        catchup.kind === 'resync'
          ? [{ type: 'resync', id: this.events.cursor(), data: {} }]
          : catchup.changes.map((entry) => this.toMessage(entry));
      const ready: MessageEvent = { type: 'ready', id: this.events.cursor(), data: {} };

      const updates = this.events.sequenced$.pipe(map((entry) => this.toMessage(entry)));
      // Keeps proxies and idle connections from dropping the stream. It carries the
      // current id too (Nest would otherwise number it per connection).
      const heartbeat = interval(HEARTBEAT_MS).pipe(
        map((): MessageEvent => ({ type: 'ping', id: this.events.cursor(), data: {} })),
      );
      return concat(from([...missed, ready]), merge(updates, heartbeat));
    });
  }

  private toMessage(entry: SequencedChange): MessageEvent {
    return { type: 'auction.updated', id: this.events.eventId(entry.seq), data: this.toPublic(entry.change) };
  }

  private toPublic(change: AuctionChange): AuctionUpdateDto {
    return {
      vehicleId: change.vehicleId,
      reason: change.reason,
      auction: toAuctionState(change.row, this.clock.now()),
      lastBid: change.lastBid && {
        amount: change.lastBid.amount,
        bidderHandle: bidderHandle(change.lastBid.bidderId),
        placedAt: new Date(change.lastBid.placedAt).toISOString(),
        kind: change.lastBid.kind,
      },
    };
  }
}
