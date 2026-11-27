import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { UiIcon } from '../icon/icon';

/** Where a stop is on the road: behind you, where you are, or ahead. */
export type UiTrailState = 'done' | 'current' | 'ahead';

export interface UiTrailStop {
  id: string;
  label: string;
  /** One short line under the label: "3 of 4 steps", "12 h". */
  detail?: string;
  state: UiTrailState;
}

/**
 * A road of milestones, left to right: the stops behind you filled, the one
 * you are on ringed and marked "You are here", the ones ahead outlined.
 * Use it for anything walked in order (a learning path's stages, an
 * onboarding). Each stop is a button that emits `pick` with its id.
 *
 * ```html
 * <ui-trail label="Stages" [stops]="stops()" (pick)="open($event)" />
 * ```
 */
@Component({
  selector: 'ui-trail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: { class: 'ui-trail' },
  template: `<ol class="road" [attr.aria-label]="label()">
    @for (stop of stops(); track stop.id; let i = $index) {
      <li
        class="stop"
        [class]="'stop stop--' + stop.state"
        [attr.aria-current]="stop.state === 'current' ? 'step' : null"
      >
        <button type="button" class="stop__button" (click)="pick.emit(stop.id)">
          <span class="stop__mark" aria-hidden="true">
            @if (stop.state === 'done') {
              <ui-icon name="check" [size]="14" />
            } @else {
              {{ i + 1 }}
            }
          </span>
          <span class="stop__label">{{ stop.label }}</span>
          @if (stop.detail) {
            <span class="stop__detail">{{ stop.detail }}</span>
          }
          @if (stop.state === 'current') {
            <span class="stop__here">{{ hereLabel() }}</span>
          }
          <span class="visually-hidden">
            · {{ stop.state === 'done' ? 'done' : stop.state === 'current' ? hereLabel() : 'ahead' }}
          </span>
        </button>
      </li>
    }
  </ol>`,
  styles: `
    :host {
      display: block;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .road {
      display: grid;
      grid-auto-columns: minmax(7rem, 1fr);
      grid-auto-flow: column;
      margin: 0;
      padding: var(--space-1) 0 var(--space-2);
      list-style: none;
    }
    .stop {
      position: relative;
      min-width: 0;
    }
    /* The road between this stop and the next. */
    .stop:not(:last-child)::after {
      position: absolute;
      top: calc(var(--space-1) + var(--space-4) - 1px);
      left: calc(50% + var(--space-4) + var(--space-2));
      right: calc(-50% + var(--space-4) + var(--space-2));
      height: 2px;
      border-radius: var(--radius-full);
      background: var(--border-subtle);
      content: '';
    }
    .stop--done:not(:last-child)::after {
      background: var(--accent);
    }
    .stop__button {
      display: grid;
      justify-items: center;
      gap: var(--space-1);
      width: 100%;
      padding: var(--space-1) var(--space-2);
      border: 0;
      border-radius: var(--radius-md);
      background: none;
      color: inherit;
      font: inherit;
      text-align: center;
      cursor: pointer;
    }
    .stop__button:hover .stop__label {
      text-decoration: underline;
    }
    .stop__button:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }
    .stop__mark {
      display: grid;
      place-items: center;
      width: var(--space-8);
      height: var(--space-8);
      border: 2px solid var(--border-strong);
      border-radius: var(--radius-full);
      background: var(--surface-card);
      color: var(--text-muted);
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .stop--done .stop__mark {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--accent-contrast);
    }
    .stop--current .stop__mark {
      border-color: var(--accent);
      box-shadow: 0 0 0 4px var(--accent-soft);
      color: var(--accent);
    }
    .stop__here {
      color: var(--accent-2);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .stop__label {
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.3;
    }
    .stop--ahead .stop__label {
      color: var(--text-secondary);
      font-weight: 500;
    }
    .stop__detail {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class UiTrail {
  readonly stops = input.required<readonly UiTrailStop[]>();
  /** What the road is, for screen readers: "Stages of Team leadership". */
  readonly label = input('Milestones');
  readonly hereLabel = input('You are here');
  readonly pick = output<string>();
}
