import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { daysText } from './format';

/*
 * The parts every record-keeping area's page is made of: its tabs, its stat
 * tiles, a small bar chart, a "days left" tag, and the client for its records.
 */

export interface LiTab<T extends string = string> {
  id: T;
  label: string;
  icon: UiIconName;
  /** A count shown on the tab: what needs you there. */
  count?: number;
}

/** The tab bar of an area: `<li-tabs [tabs]="tabs()" [(active)]="tab" label="Money" />`. */
@Component({
  selector: 'li-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `
    <nav class="tabs" [attr.aria-label]="label()">
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          class="tab"
          [class.tab--on]="active() === t.id"
          [attr.aria-current]="active() === t.id ? 'page' : null"
          (click)="active.set(t.id)"
        >
          <ui-icon [name]="t.icon" [size]="18" />
          <span>{{ t.label }}</span>
          @if (t.count) {
            <span class="tab__count">{{ t.count }}</span>
          }
        </button>
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--space-6);
    }
    .tabs {
      display: flex;
      gap: var(--space-1);
      padding: var(--space-2);
      overflow-x: auto;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      background: var(--surface-glass);
      box-shadow: var(--shadow-card);
      scrollbar-width: thin;
    }
    .tab {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border: 0;
      border-radius: var(--radius-md);
      background: none;
      color: var(--text-secondary);
      font-family: var(--font-display);
      font-size: var(--text-md);
      font-weight: 600;
      cursor: pointer;
      transition:
        background-color var(--duration-fast) var(--ease-out),
        color var(--duration-fast) var(--ease-out);
    }
    .tab:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
    .tab--on,
    .tab--on:hover {
      background: var(--accent-gradient);
      box-shadow: var(--accent-glow);
      color: var(--accent-contrast);
    }
    .tab__count {
      min-width: var(--space-5);
      padding: 0 var(--space-1);
      border-radius: var(--radius-full);
      background: var(--tone-warning-soft);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      text-align: center;
    }
  `,
})
export class LiTabs {
  readonly tabs = input.required<readonly LiTab[]>();
  readonly active = model.required<string>();
  readonly label = input('Sections');
}

/** One bar of `li-bars`. */
export interface LiBar {
  label: string;
  value: number;
  /** A second, lighter value drawn behind (a budget, an average). */
  target?: number | null;
  /** Shown on hover and to screen readers. */
  title?: string;
  tone?: 'accent' | 'warning' | 'danger' | 'muted';
}

/**
 * A small column chart: months of spending, weeks of minutes. A dashed line
 * marks the goal when there is one. The numbers are in a visually hidden
 * table for screen readers.
 */
@Component({
  selector: 'li-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart" [style.--count]="bars().length" aria-hidden="true">
      @if (goal(); as g) {
        <span class="goal" [style.bottom.%]="(g / max()) * 100">
          <span class="goal__label">{{ goalLabel() }}</span>
        </span>
      }
      @for (bar of bars(); track $index) {
        <div class="col" [title]="bar.title ?? bar.label + ': ' + bar.value">
          <div class="track">
            @if (bar.target) {
              <span
                class="target"
                [style.height.%]="(bar.target / max()) * 100"
              ></span>
            }
            <span
              class="bar"
              [class]="'bar bar--' + (bar.tone ?? 'accent')"
              [style.height.%]="(Math.max(0, bar.value) / max()) * 100"
            ></span>
          </div>
          <span class="label">{{ bar.label }}</span>
        </div>
      }
    </div>
    <table class="ui-visually-hidden">
      <caption>
        {{
          caption()
        }}
      </caption>
      <tbody>
        @for (bar of bars(); track $index) {
          <tr>
            <th scope="row">{{ bar.label }}</th>
            <td>{{ bar.title ?? bar.value }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host {
      display: block;
    }
    .chart {
      position: relative;
      display: grid;
      grid-template-columns: repeat(var(--count), minmax(0, 1fr));
      gap: var(--space-1);
      align-items: end;
      height: 10rem;
      padding-top: var(--space-4);
    }
    .col {
      display: grid;
      grid-template-rows: 1fr auto;
      gap: var(--space-1);
      height: 100%;
      min-width: 0;
    }
    .track {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      height: 100%;
    }
    .bar,
    .target {
      position: absolute;
      bottom: 0;
      width: 70%;
      max-width: 2.5rem;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      transition: height var(--duration-slow) var(--ease-out);
    }
    .target {
      width: 90%;
      max-width: 3rem;
      background: var(--surface-sunken);
      border: 1px dashed var(--border-strong);
    }
    .bar--accent {
      background: var(--accent);
    }
    .bar--warning {
      background: var(--tone-warning);
    }
    .bar--danger {
      background: var(--tone-danger);
    }
    .bar--muted {
      background: var(--border-strong);
    }
    .label {
      overflow: hidden;
      color: var(--text-muted);
      font-size: var(--text-xs);
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .goal {
      position: absolute;
      right: 0;
      left: 0;
      margin-bottom: calc(var(--space-4) + var(--space-1));
      border-top: 2px dashed var(--accent-2);
      pointer-events: none;
    }
    .goal__label {
      position: absolute;
      top: calc(-1 * var(--space-5));
      right: 0;
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
  `,
})
export class LiBars {
  readonly bars = input.required<readonly LiBar[]>();
  readonly goal = input<number | null>(null);
  readonly goalLabel = input('Goal');
  readonly caption = input('Chart');
  protected readonly Math = Math;
  protected readonly max = computed(() =>
    Math.max(
      1,
      this.goal() ?? 0,
      ...this.bars().flatMap((bar) => [bar.value, bar.target ?? 0]),
    ),
  );
}

/** "in 5 days" with a tone: red once past, amber within `warnDays`. */
@Component({
  selector: 'li-due',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="due" [class]="'due due--' + tone()">{{
    prefix() ? prefix() + ' ' : ''
  }}{{ text() }}</span>`,
  styles: `
    .due {
      display: inline-flex;
      align-items: center;
      padding: 0 var(--space-2);
      border-radius: var(--radius-full);
      font-size: var(--text-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .due--danger {
      background: var(--tone-danger-soft);
      color: var(--tone-danger);
    }
    .due--warning {
      background: var(--tone-warning-soft);
      color: var(--text-primary);
    }
    .due--neutral {
      background: var(--tone-neutral-soft);
      color: var(--text-secondary);
    }
    .due--success {
      background: var(--tone-success-soft);
      color: var(--tone-success);
    }
  `,
})
export class LiDue {
  readonly days = input.required<number | null>();
  readonly warnDays = input(14);
  readonly prefix = input('');
  /** A date that is good news (a trip), never red. */
  readonly happy = input(false);
  protected readonly text = computed(() => daysText(this.days()));
  protected readonly tone = computed(() => {
    const days = this.days();
    if (days === null) return 'neutral';
    if (this.happy()) return days <= this.warnDays() ? 'success' : 'neutral';
    if (days < 0) return 'danger';
    if (days <= this.warnDays()) return 'warning';
    return 'neutral';
  });
}

/**
 * The client of an area's plain records (`POST /:collection`,
 * `PUT /:collection/:id`, `DELETE /:collection/:id`). An area's API extends it:
 * `class MoneyApi extends RecordsApi { constructor() { super('/api/money'); } }`.
 */
export abstract class RecordsApi {
  protected readonly http = inject(HttpClient);

  protected constructor(readonly base: string) {}

  create(collection: string, body: unknown): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/${collection}`, body);
  }

  update(collection: string, id: string, body: unknown): Observable<void> {
    return this.http.put<void>(`${this.base}/${collection}/${id}`, body);
  }

  remove(collection: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${collection}/${id}`);
  }

  /** Adds or updates: an id updates, none adds. */
  save(
    collection: string,
    id: string | null | undefined,
    body: unknown,
  ): Observable<unknown> {
    return id
      ? this.update(collection, id, body)
      : this.create(collection, body);
  }
}
