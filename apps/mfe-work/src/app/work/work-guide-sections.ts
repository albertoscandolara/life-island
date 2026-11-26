import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { WorkGuideSection } from './work-guide';

/**
 * A topic of the Work guide: one fold per question, the first open when
 * `openFirst` is set. `text` fills in figures that depend on the year.
 * Anything projected follows the folds (links, sources).
 */
@Component({
  selector: 'work-guide-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (s of sections(); track s.id; let first = $first) {
      <details [open]="first && openFirst()">
        <summary>{{ s.title }}</summary>
        @for (p of s.body; track $index) {
          <p>{{ text()(p) }}</p>
        }
        @if (s.points?.length) {
          <ul>
            @for (p of s.points; track $index) {
              <li>{{ text()(p) }}</li>
            }
          </ul>
        }
      </details>
    }
    <ng-content />
  `,
})
export class WorkGuideSections {
  readonly sections = input.required<readonly WorkGuideSection[]>();
  readonly openFirst = input(false);
  readonly text = input<(value: string) => string>((value) => value);
}
