import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiAlert } from '@life-island/design-system';
import { ReclassificationState } from './reclassification-state';

/** App-wide notice while a reclassification holds the lock. */
@Component({
  selector: 'app-reclassification-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAlert],
  template: `
    @if (reclassification.locked()) {
      <ui-alert tone="progress" role="status">
        <strong class="heading"
          >Checking past documents against new categories</strong
        >
        <p>
          Uploads, parsing and changes to documents and categories are paused
          until it finishes. You can still browse and read everything.
          @if (reclassification.value()?.currentRun?.startedAt; as started) {
            Started {{ started | date: 'dd MMM yyyy, HH:mm' }}.
          }
        </p>
        @if (progress(); as p) {
          <p>{{ p }}</p>
        }
      </ui-alert>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    :host:empty {
      display: none;
    }
    ui-alert {
      margin-bottom: var(--space-4);
    }
    .heading {
      display: block;
    }
    p {
      margin: var(--space-1) 0 0;
    }
  `,
})
export class ReclassificationBanner {
  protected readonly reclassification = inject(ReclassificationState);

  protected progress(): string | null {
    const summary = this.reclassification.value()?.currentRun?.summary;
    if (!summary?.['eligible']) return null;
    return `${summary['checked'] ?? 0} of ${summary['eligible']} documents checked.`;
  }
}
