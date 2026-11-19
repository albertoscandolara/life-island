import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';

/**
 * The id of every area's "To review" block: what its "Needs you" Review
 * buttons, the Agenda and the digest open (with `?tab=review`).
 */
export const TO_REVIEW_ID = 'to-review';

/**
 * "To review", the one place of an area where the documents it was sent wait
 * for you: a document never changes the area on its own. Every area that
 * takes documents shows it the same way, as its `review` tab
 * (`toReviewPath()` in contracts): the count, what approving does, each
 * document as an `<li-review-item>`, and when nothing waits, the way to load
 * one.
 *
 * ```html
 * <li-to-review [count]="reviews().length" what="car documents" [error]="error()">
 *   <p intro>New car documents never change a car on their own…</p>
 *   @for (r of reviews(); track r.uploadId) { <li-review-item …>…</li-review-item> }
 * </li-to-review>
 * ```
 */
@Component({
  selector: 'li-to-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiBadge, UiButton, UiCard, UiEmptyState, UiIcon],
  host: { '[id]': 'id', class: 'li-block' },
  template: `
    @if (error(); as message) {
      <ui-alert tone="danger" role="alert">{{ message }}</ui-alert>
    }
    <ui-card heading="To review">
      @if (count()) {
        <ui-badge uiCardActions tone="warning">{{ count() }} waiting</ui-badge>
      } @else {
        <a uiCardActions uiButton variant="ghost" size="sm" [href]="loadUrl()"
          ><ui-icon name="upload" [size]="16" /> Load a document</a
        >
      }
      <div class="li-intro li-muted"><ng-content select="[intro]" /></div>
      @if (!count()) {
        <ui-empty-state heading="Nothing to review" icon="check">
          <p class="li-muted">
            {{ capitalised() }} you load in the documents app show up here once
            they are read. Approving one is what adds it.
          </p>
        </ui-empty-state>
      }
      <ng-content />
    </ui-card>
  `,
  styles: `
    :host {
      display: block;
    }
    .li-intro ::ng-deep p {
      margin: 0;
    }
  `,
})
export class LiToReview {
  protected readonly id = TO_REVIEW_ID;
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  /** How many documents wait. */
  readonly count = input.required<number>();
  /** What this area takes, plural: "car documents", "ID documents". */
  readonly what = input.required<string>();
  /** The last approve or reject that failed, said plainly. */
  readonly error = input<string | null>(null);

  protected readonly loadUrl = computed(() => {
    const base = this.documentsUrl.endsWith('/')
      ? this.documentsUrl
      : `${this.documentsUrl}/`;
    return `${base}upload`;
  });
  protected readonly capitalised = computed(() => {
    const what = this.what();
    return what.charAt(0).toUpperCase() + what.slice(1);
  });
}

/**
 * One document in "To review": what it is (`heading`, and anything more in
 * `[title]`), a line about it, the button that opens the file, then the
 * area's own choices and, in `[actions]`, its Reject and Approve buttons.
 */
@Component({
  selector: 'li-review-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiIcon],
  host: {
    class: 'li-review',
    '[class.li-review--busy]': 'busy()',
    '[attr.aria-busy]': 'busy()',
  },
  template: `
    <header class="li-review__head">
      <div>
        <h3 class="li-review__title">
          {{ heading() }} <ng-content select="[title]" />
        </h3>
        <p class="li-muted"><ng-content select="[meta]" /></p>
      </div>
      <a
        uiButton
        variant="ghost"
        size="sm"
        [href]="previewUrl()"
        target="_blank"
        rel="noopener"
        [attr.aria-label]="'Open ' + heading()"
      >
        <ui-icon name="eye" [size]="16" /> Open
      </a>
    </header>
    <ng-content />
    <footer class="li-review__actions">
      <ng-content select="[actions]" />
    </footer>
  `,
  styles: `
    :host {
      display: grid;
    }
  `,
})
export class LiReviewItem {
  /** What the document is: "Insurance certificate", "Payslip". */
  readonly heading = input.required<string>();
  /** The file itself, opened in a new tab. */
  readonly previewUrl = input.required<string>();
  /** Its approve or reject is running. */
  readonly busy = input(false);
}
