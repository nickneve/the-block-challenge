import { VehicleRow } from '../vehicles/vehicle-row';
import { AuctionChange, AuctionEventsService, REPLAY_BUFFER_SIZE } from './auction-events.service';

const change = (vehicleId: string): AuctionChange => ({ vehicleId, reason: 'bid', row: {} as VehicleRow, lastBid: null });

describe('AuctionEventsService catch-up', () => {
  let events: AuctionEventsService;

  beforeEach(() => {
    events = new AuctionEventsService();
  });

  it('numbers changes and tells a fresh client nothing was missed', () => {
    events.publish(change('a'));
    expect(events.cursor()).toBe(events.eventId(1));
    expect(events.since(undefined)).toEqual({ kind: 'replay', changes: [] });
  });

  it('replays exactly the changes after the last id a client saw', () => {
    events.publish(change('a'));
    const seen = events.cursor();
    events.publish(change('b'));
    events.publish(change('c'));

    const catchup = events.since(seen);
    expect(catchup.kind).toBe('replay');
    expect(catchup.kind === 'replay' && catchup.changes.map((entry) => entry.change.vehicleId)).toEqual(['b', 'c']);
    expect(events.since(events.cursor())).toEqual({ kind: 'replay', changes: [] });
  });

  it('asks for a resync when the missed changes are no longer kept', () => {
    events.publish(change('first'));
    const seen = events.cursor();
    for (let i = 0; i < REPLAY_BUFFER_SIZE + 1; i++) events.publish(change(`v${i}`));
    expect(events.since(seen)).toEqual({ kind: 'resync' });
  });

  it('asks for a resync for ids from another server process or that make no sense', () => {
    events.publish(change('a'));
    const other = new AuctionEventsService();
    expect(events.since(other.cursor())).toEqual({ kind: 'resync' });
    expect(events.since(events.eventId(99))).toEqual({ kind: 'resync' });
    expect(events.since('garbage')).toEqual({ kind: 'resync' });
  });

  it('pushes each change to subscribers with its sequence number', () => {
    const seen: number[] = [];
    events.sequenced$.subscribe((entry) => seen.push(entry.seq));
    events.publish(change('a'));
    events.publish(change('b'));
    expect(seen).toEqual([1, 2]);
  });
});
