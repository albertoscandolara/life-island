import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AgendaEntryDto } from '@life-island/contracts';
import { UiButton, UiIcon } from '@life-island/design-system';
import { LiDue, euro } from '@life-island/records-ui';
import { areaOf } from './areas';

/** A list of agenda lines: date, what, which area, days left, and Done. */
@Component({
  selector: 'agenda-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiDue, RouterLink, UiButton, UiIcon],
  template: `
    <ul class="li-list">
      @for (e of entries(); track e.key) {
        <li class="line" [class.line--done]="e.handled">
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
            @if (!e.handled) {
              <li-due [days]="e.daysLeft" [warnDays]="7" />
            } @else {
              <span class="li-good li-small">Handled</span>
            }
            <span class="buttons">
              @if (e.path) {
                <a
                  uiButton
                  variant="ghost"
                  size="sm"
                  [routerLink]="e.path"
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
              <button
                uiButton
                [variant]="e.handled ? 'ghost' : 'secondary'"
                size="sm"
                type="button"
                [title]="e.handled ? 'Mark as not done' : 'Mark as done'"
                (click)="toggle.emit(e)"
              >
                <ui-icon [name]="e.handled ? 'refresh' : 'check'" [size]="16" />
                {{ e.handled ? 'Undo' : 'Done' }}
              </button>
            </span>
          </span>
        </li>
      }
    </ul>
  `,
  styles: `
    .line {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: var(--space-3);
      align-items: center;
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--surface-card);
    }
    .line--done {
      opacity: 0.6;
    }
    .line--done .title {
      text-decoration: line-through;
    }
    .date {
      display: grid;
      place-items: center;
      width: var(--space-12);
      padding: var(--space-1) 0;
      border-radius: var(--radius-md);
      background: var(--accent-soft);
      color: var(--accent);
      line-height: 1.1;
    }
    .date--late {
      background: var(--tone-danger-soft);
      color: var(--tone-danger);
    }
    .date__day {
      font-family: var(--font-display);
      font-size: var(--text-lg);
      font-weight: 600;
    }
    .date__month {
      font-size: var(--text-xs);
      text-transform: uppercase;
    }
    .body {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
    }
    .title {
      font-weight: 600;
    }
    .detail {
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
    .side {
      display: grid;
      gap: var(--space-1);
      justify-items: end;
    }
    .buttons {
      display: flex;
      gap: var(--space-1);
    }
    @media (max-width: 40rem) {
      .line {
        grid-template-columns: auto 1fr;
      }
      .side {
        grid-column: 1 / -1;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    }
  `,
})
export class EntryList {
  readonly entries = input.required<readonly AgendaEntryDto[]>();
  readonly showDetail = input(true);
  readonly toggle = output<AgendaEntryDto>();
  readonly edit = output<AgendaEntryDto>();

  protected readonly euro = euro;
  protected readonly area = areaOf;

  protected day(date: string): string {
    return String(Number(date.slice(8, 10)));
  }

  protected month(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short',
    });
  }
}
