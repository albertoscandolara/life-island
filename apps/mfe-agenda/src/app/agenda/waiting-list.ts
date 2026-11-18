import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { agendaArea, type AgendaWaitingDto } from '@life-island/contracts';
import { UiButton, UiIcon } from '@life-island/design-system';
import { dateText } from '@life-island/records-ui';

/**
 * What the areas wait on you for with no date: a document to approve, a
 * check-in, an item running out. Each line opens the place that handles it;
 * it leaves the list once it is handled there.
 */
@Component({
  selector: 'agenda-waiting-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButton, UiIcon],
  styleUrl: './agenda-lines.css',
  template: `
    <ul class="li-list">
      @for (w of items(); track w.key) {
        <li class="line">
          <span class="badge" aria-hidden="true">{{
            area(w.module).emblem
          }}</span>
          <span class="body">
            <span class="title">{{ w.title }}</span>
            <span class="li-meta">
              <span>{{ area(w.module).name }}</span>
              @if (w.since) {
                <span>Waiting since {{ dateText(w.since) }}</span>
              }
            </span>
            @if (w.detail) {
              <span class="detail">{{ w.detail }}</span>
            }
          </span>
          <span class="side">
            <a
              uiButton
              variant="secondary"
              size="sm"
              [routerLink]="w.path"
              [attr.aria-label]="w.action + ': ' + w.title"
            >
              {{ w.action }}
              <ui-icon name="external" [size]="16" />
            </a>
          </span>
        </li>
      }
    </ul>
  `,
})
export class WaitingList {
  readonly items = input.required<readonly AgendaWaitingDto[]>();

  protected readonly area = agendaArea;
  protected readonly dateText = dateText;
}
