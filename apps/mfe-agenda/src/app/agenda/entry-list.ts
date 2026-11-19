import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { agendaArea, type AgendaEntryDto } from '@life-island/contracts';
import { UiButton, UiIcon } from '@life-island/design-system';
import { LiDue, appLink, euro } from '@life-island/records-ui';

/** A list of agenda lines: date, what, which area, days left, and Done. */
@Component({
  selector: 'agenda-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiDue, RouterLink, UiButton, UiIcon],
  template: `
    <ul class="li-list">
      @for (e of entries(); track e.key) {
        <li
          class="line"
          [class.line--done]="e.handled"
          [class.line--auto]="e.autoPaid"
        >
          <span class="date" [class.date--late]="!e.handled && e.daysLeft < 0">
            <span class="date__day">{{ day(e.date) }}</span>
            <span class="date__month">{{ month(e.date) }}</span>
          </span>
          <span class="body">
            <span class="title">
              {{ e.title }}
              @if (e.time) {
                <span class="li-muted"> · {{ e.time }}</span>
              }
            </span>
            <span class="li-meta">
              <span>{{ area(e.module).emblem }} {{ area(e.module).name }}</span>
              @if (e.source === 'calendar') {
                <span>Every year</span>
              }
              @if (e.amount) {
                <span>{{ euro(e.amount) }}</span>
              }
            </span>
            @if (e.detail && showDetail()) {
              <span class="detail">{{ e.detail }}</span>
            }
          </span>
          <span class="side">
            @if (e.autoPaid) {
              <span
                class="li-good li-small"
                title="Paid on its own by direct debit or a card on file: nothing to do"
                >Paid automatically</span
              >
            } @else if (!e.handled) {
              <li-due [days]="e.daysLeft" [warnDays]="7" />
            } @else {
              <span class="li-good li-small">Handled</span>
            }
            <span class="buttons">
              @if (e.path) {
                @let link = appLink(e.path);
                <a
                  uiButton
                  variant="ghost"
                  size="sm"
                  [routerLink]="link.path"
                  [queryParams]="link.query"
                  [fragment]="link.fragment"
                  [attr.aria-label]="'Open ' + area(e.module).name"
                  title="Open the area"
                  ><ui-icon name="external" [size]="16"
                /></a>
              }
              @if (e.itemId) {
                <button
                  uiButton
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label="Edit the item"
                  title="Edit"
                  (click)="edit.emit(e)"
                >
                  <ui-icon name="edit" [size]="16" />
                </button>
              }
              @if (!e.autoPaid) {
                <button
                  uiButton
                  [variant]="e.handled ? 'ghost' : 'secondary'"
                  size="sm"
                  type="button"
                  [title]="e.handled ? 'Mark as not done' : 'Mark as done'"
                  (click)="toggleDone.emit(e)"
                >
                  <ui-icon
                    [name]="e.handled ? 'refresh' : 'check'"
                    [size]="16"
                  />
                  {{ e.handled ? 'Undo' : 'Done' }}
                </button>
              }
            </span>
          </span>
        </li>
      }
    </ul>
  `,
  styleUrl: './agenda-lines.css',
})
export class EntryList {
  readonly entries = input.required<readonly AgendaEntryDto[]>();
  readonly showDetail = input(true);
  readonly toggleDone = output<AgendaEntryDto>();
  readonly edit = output<AgendaEntryDto>();

  protected readonly euro = euro;
  protected readonly area = agendaArea;
  protected readonly appLink = appLink;

  protected day(date: string): string {
    return String(Number(date.slice(8, 10)));
  }

  protected month(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short',
    });
  }
}
