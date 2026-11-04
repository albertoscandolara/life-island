import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UiButton, UiIcon } from '@life-island/design-system';
import { propertyColor } from './format';
import { PropertyStore } from './property-store';

/**
 * The bar both views share: Home or Bills, and which home you look at, all
 * of them together, or side by side. The choice lives in the URL
 * (`?property=…&split=1`), so it survives switching view and reloading.
 */
@Component({
  selector: 'home-area-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIcon, UiButton],
  template: `
    <nav class="tabs" aria-label="Home area">
      <a
        class="tab"
        [class.tab--on]="area() === 'home'"
        [attr.aria-current]="area() === 'home' ? 'page' : null"
        [routerLink]="area() === 'home' ? [] : ['..']"
        queryParamsHandling="preserve"
        data-character="bronto"
      >
        <ui-icon name="home" [size]="18" /> Home
      </a>
      <a
        class="tab"
        [class.tab--on]="area() === 'bills'"
        [attr.aria-current]="area() === 'bills' ? 'page' : null"
        [routerLink]="area() === 'bills' ? [] : ['bills']"
        queryParamsHandling="preserve"
        data-character="stego"
      >
        <ui-icon name="bolt" [size]="18" /> Bills
      </a>
    </nav>

    <div class="homes" role="group" aria-label="Which home">
      <button
        type="button"
        class="chip"
        [class.chip--on]="!property()"
        [attr.aria-pressed]="!property()"
        (click)="select(null)"
      >
        <ui-icon name="layers" [size]="16" /> All homes
      </button>
      @for (p of store.properties() ?? []; track p.id) {
        <button
          type="button"
          class="chip"
          [class.chip--on]="property() === p.id"
          [attr.aria-pressed]="property() === p.id"
          (click)="select(p.id)"
        >
          <span class="dot" [style.background]="color(p.colorSlot)"></span>
          {{ p.name }}
        </button>
      }
      @if (
        area() === 'bills' &&
        !property() &&
        (store.properties()?.length ?? 0) > 1
      ) {
        <span class="split" role="group" aria-label="How to show them">
          <button
            type="button"
            class="seg"
            [class.seg--on]="!split()"
            [attr.aria-pressed]="!split()"
            (click)="setSplit(false)"
          >
            Together
          </button>
          <button
            type="button"
            class="seg"
            [class.seg--on]="split()"
            [attr.aria-pressed]="split()"
            (click)="setSplit(true)"
          >
            Side by side
          </button>
        </span>
      }
      <button
        uiButton
        variant="ghost"
        size="sm"
        type="button"
        class="manage"
        (click)="manage.emit()"
      >
        <ui-icon name="edit" [size]="16" /> Homes
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-6);
      padding: var(--space-2);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      background: var(--surface-glass);
      backdrop-filter: blur(12px);
      box-shadow: var(--shadow-card);
      position: sticky;
      top: var(--space-2);
      z-index: var(--layer-sticky);
    }
    .tabs,
    .homes,
    .split {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1);
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-family: var(--font-display);
      font-weight: 600;
      text-decoration: none;
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
    .chip,
    .seg {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--control-height-sm);
      padding: 0 var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-full);
      background: var(--surface-card);
      color: var(--text-secondary);
      font: inherit;
      font-size: var(--text-sm);
      cursor: pointer;
      transition:
        border-color var(--duration-fast) var(--ease-out),
        background-color var(--duration-fast) var(--ease-out);
    }
    .chip:hover,
    .seg:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }
    .chip--on,
    .seg--on {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--text-primary);
      font-weight: 600;
    }
    .split {
      gap: 0;
      margin-left: var(--space-2);
    }
    .split .seg:first-child {
      border-radius: var(--radius-full) 0 0 var(--radius-full);
    }
    .split .seg:last-child {
      border-left: 0;
      border-radius: 0 var(--radius-full) var(--radius-full) 0;
    }
    .dot {
      width: var(--space-2);
      height: var(--space-2);
      border-radius: var(--radius-full);
    }
    .manage {
      margin-left: var(--space-1);
    }
    @media (width <= 40rem) {
      :host {
        position: static;
      }
    }
  `,
})
export class AreaNav {
  protected readonly store = inject(PropertyStore);
  private readonly router = inject(Router);

  readonly area = input.required<'home' | 'bills'>();
  /** The selected property id; null for all of them. */
  readonly property = input<string | null>(null);
  readonly split = input(false);
  readonly manage = output<void>();

  protected readonly color = propertyColor;
  protected readonly count = computed(
    () => this.store.properties()?.length ?? 0,
  );

  protected select(id: string | null): void {
    void this.router.navigate([], {
      queryParams: { property: id, split: null },
      queryParamsHandling: 'merge',
    });
  }

  protected setSplit(on: boolean): void {
    void this.router.navigate([], {
      queryParams: { split: on ? 1 : null },
      queryParamsHandling: 'merge',
    });
  }
}
