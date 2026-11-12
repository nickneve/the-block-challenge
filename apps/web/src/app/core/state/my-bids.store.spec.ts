import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { AuctionApi } from '../api/auction-api';
import { VehicleSummary } from '../api/models';
import { BidderService } from '../bidder.service';
import { LiveAuctionService } from '../live-auction.service';
import { ToastService } from '../toast.service';
import { MyBidsStore } from './my-bids.store';

describe('MyBidsStore loading', () => {
  let response: () => Observable<VehicleSummary[]>;
  let calls: number;
  const resync$ = new Subject<void>();

  beforeEach(() => {
    calls = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuctionApi,
          useValue: {
            myBids: () => {
              calls++;
              return response();
            },
          },
        },
        { provide: BidderService, useValue: { handle: signal('Bidder 1111') } },
        { provide: LiveAuctionService, useValue: { updates$: EMPTY, resync$ } },
        { provide: ToastService, useValue: { show: () => undefined } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reports a failed load as an error, not as "no bids"', () => {
    response = () => throwError(() => new Error('500'));
    const store = TestBed.inject(MyBidsStore);
    store.start();

    expect(store.loaded()).toBe(true);
    expect(store.error()).toBe(true);
    expect(store.items()).toEqual([]);
  });

  it('clears the error once a retry works', () => {
    response = () => throwError(() => new Error('500'));
    const store = TestBed.inject(MyBidsStore);
    store.start();

    response = () => of([{ id: 'v1' } as VehicleSummary]);
    store.refresh();
    expect(store.error()).toBe(false);
    expect(store.items().map((item) => item.id)).toEqual(['v1']);
  });

  it('reloads when the live stream says updates were missed', () => {
    response = () => of([]);
    const store = TestBed.inject(MyBidsStore);
    store.start();
    expect(calls).toBe(1);

    resync$.next();
    expect(calls).toBe(2);
  });
});
