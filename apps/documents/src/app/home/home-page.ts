import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { UiIcon } from '@life-island/design-system';
import { ReviewApi } from '../api/review-api';
import { ReclassificationState } from '../reclassification/reclassification-state';

/** The start screen: choose between loading new documents and reviewing parsed ones. */
@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIcon],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  private readonly api = inject(ReviewApi);

  /** How many parsed records wait for a confirmation; the count is a hint, so errors just hide it. */
  private readonly waiting = rxResource({
    stream: () => this.api.list({ status: 'PARSED', limit: 1 }),
  });
  /** Documents a later check found newer categories for. */
  protected readonly pendingReview = inject(ReclassificationState)
    .pendingReview;
  protected readonly waitingCount = computed(() =>
    this.waiting.hasValue() ? this.waiting.value().total : null,
  );
}
