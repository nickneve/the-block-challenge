import { computed, inject, Injectable, signal } from '@angular/core';
import { AuctionApi } from '../api/auction-api';
import { ToastService } from '../toast.service';

/** Ids of watched lots. Optimistic: the star flips instantly and rolls back on failure. */
@Injectable({ providedIn: 'root' })
export class WatchlistStore {
  private readonly api = inject(AuctionApi);
  private readonly toasts = inject(ToastService);

  readonly ids = signal<ReadonlySet<string>>(new Set());
  readonly count = computed(() => this.ids().size);
  /** The last load failed, so the stars and count can't be trusted until a retry works. */
  readonly error = signal(false);

  start(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.myWatchlist().subscribe({
      next: (items) => {
        this.ids.set(new Set(items.map((item) => item.id)));
        this.error.set(false);
      },
      error: () => this.error.set(true),
    });
  }

  isWatched(id: string): boolean {
    return this.ids().has(id);
  }

  toggle(id: string): void {
    const watching = this.isWatched(id);
    this.set(id, !watching);

    const request = watching ? this.api.unwatch(id) : this.api.watch(id);
    request.subscribe({
      error: () => {
        this.set(id, watching);
        this.toasts.show({ tone: 'danger', title: "Couldn't update your watchlist", message: 'Please try again.' });
      },
    });
  }

  private set(id: string, watched: boolean): void {
    this.ids.update((ids) => {
      const next = new Set(ids);
      if (watched) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
