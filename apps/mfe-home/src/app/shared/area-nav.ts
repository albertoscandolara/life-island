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
import { selectionParams } from './selection';

/**
 * The bar every view of Houses shares: the house itself, its renovations and
 * its bills, and which houses you look at (one, several, or all of them,
 * together or side by side). The choice lives in the URL
 * (`?houses=…&split=1`), so it survives switching view and reloading.
 */
@Component({
  selector: 'home-area-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIcon, UiButton],
  template: `
    <nav class="tabs" aria-label="Houses">
      @for (tab of tabs; track tab.area) {
        <a
          class="tab"
          [class.tab--on]="area() === tab.area"
          [attr.aria-current]="area() === tab.area ? 'page' : null"
          [routerLink]="link(tab.area)"
          queryParamsHandling="preserve"
          [attr.data-character]="tab.character"
        >
          <ui-icon [name]="tab.icon" [size]="18" /> {{ tab.label }}
        </a>
      }
    </nav>

    @if (area() !== 'companies') {
      <div class="homes" role="group" aria-label="Which houses">
        <button
          type="button"
          class="chip"
          [class.chip--on]="!selected().length"
          [attr.aria-pressed]="!selected().length"
          (click)="clear()"
        >
          <ui-icon name="layers" [size]="16" /> All houses
        </button>
        @for (p of store.properties() ?? []; track p.id) {
          <button
            type="button"
            class="chip"
            [class.chip--on]="selected().includes(p.id)"
            [attr.aria-pressed]="selected().includes(p.id)"
            [title]="'Click to look at it alone, Ctrl/⌘-click to add it'"
            (click)="toggle(p.id, $event)"
          >
            <span class="dot" [style.background]="color(p.colorSlot)"></span>
            {{ p.name }}
            @if (p.isResidence) {
              <ui-icon name="home" [size]="14" aria-label="Residence" />
            }
          </button>
        }
        @if (area() === 'bills' && selected().length !== 1 && count() > 1) {
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
          <ui-icon name="plus" [size]="16" /> Add a house
        </button>
      </div>
    }
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

  readonly area = input.required<HousesArea>();
  /** The selected house ids; none for all of them. */
  readonly selected = input<string[]>([]);
  readonly split = input(false);
  readonly manage = output<void>();

  protected readonly tabs = [
    { area: 'overview', label: 'Houses', icon: 'home', character: 'bronto' },
    {
      area: 'renovations',
      label: 'Renovations',
      icon: 'wrench',
      character: 'bronto',
    },
    { area: 'bills', label: 'Bills', icon: 'bolt', character: 'stego' },
    {
      area: 'companies',
      label: 'Companies',
      icon: 'layers',
      character: 'bronto',
    },
  ] as const;

  protected readonly color = propertyColor;
  protected readonly count = computed(
    () => this.store.properties()?.length ?? 0,
  );

  protected link(target: HousesArea): string[] {
    if (target === this.area()) return [];
    const up = this.area() === 'overview' ? [] : ['..'];
    return target === 'overview' ? ['..'] : [...up, target];
  }

  /** A click looks at that house alone; Ctrl, ⌘ or Shift adds it to (or takes it from) the selection. */
  protected toggle(id: string, event: MouseEvent): void {
    const current = this.selected();
    const many = event.ctrlKey || event.metaKey || event.shiftKey;
    const next = many
      ? current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id]
      : current.length === 1 && current[0] === id
        ? []
        : [id];
    this.navigate(next);
  }

  protected clear(): void {
    this.navigate([]);
  }

  protected setSplit(on: boolean): void {
    void this.router.navigate([], {
      queryParams: { split: on ? 1 : null },
      queryParamsHandling: 'merge',
    });
  }

  private navigate(ids: string[]): void {
    void this.router.navigate([], {
      queryParams: { ...selectionParams(ids), split: null },
      queryParamsHandling: 'merge',
    });
  }
}

export type HousesArea = 'overview' | 'renovations' | 'bills' | 'companies';
