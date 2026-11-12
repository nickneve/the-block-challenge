import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * "Couldn't load this" with a retry, so a failed request never passes for an
 * empty list. `inline` is the slim version, shown above data that loaded earlier
 * but couldn't be refreshed.
 */
@Component({
  selector: 'app-load-error',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="load-error" [class.load-error--inline]="inline()" role="alert">
      <svg appIcon="triangle-exclamation-point" [size]="inline() ? 18 : 32" [strokeWidth]="inline() ? 2 : 1.6"></svg>
      <div class="text">
        <p class="title">{{ title() }}</p>
        <p class="message">{{ message() }}</p>
      </div>
      <button type="button" class="btn btn--secondary btn--sm" (click)="retry.emit()">
        <svg appIcon="rotate-ccw" [size]="15"></svg>
        Try again
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .load-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-8) var(--space-4);
      text-align: center;

      > svg {
        color: var(--danger);
      }
    }

    .title {
      color: var(--text);
      font-size: 20px;
      font-weight: 700;
    }

    .message {
      max-width: 46ch;
      margin-top: var(--space-1);
      color: var(--text-muted);
    }

    .load-error--inline {
      flex-direction: row;
      margin-bottom: var(--space-4);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--warning-soft);
      text-align: left;

      > svg {
        flex: none;
        color: var(--warning);
      }

      .text {
        flex: 1;
      }

      .title {
        font-size: 15px;
      }

      .message {
        margin-top: 0;
        font-size: 14px;
      }
    }
  `,
})
export class LoadErrorComponent {
  readonly title = input.required<string>();
  readonly message = input('Check your connection and try again.');
  readonly inline = input(false);
  readonly retry = output<void>();
}
