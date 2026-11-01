import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import type { CategoryCountDto } from '@life-island/contracts';
import { UiButton, UiIcon, UiInput } from '@life-island/design-system';
import { CategoryStore } from '../categories/category-store';
import {
  categoryRows,
  textMatch,
  type CategoryRow,
} from '../categories/category-rows';

let nextId = 0;

/**
 * The review page's category filter: the category tree with a checkbox per
 * category. Selecting a category includes everything below it, so its
 * subcategories show as included. Several selections show the records of
 * any of them. Counts are what each choice would show under the other filters.
 */
@Component({
  selector: 'app-category-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiIcon, UiInput],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'close()',
  },
  template: `
    <button
      type="button"
      class="trigger"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      [attr.aria-label]="ariaLabel()"
      (click)="toggle()"
    >
      <span
        class="trigger__value"
        [class.trigger__value--empty]="!value().length"
      >
        {{ summary() }}
      </span>
      <ui-icon name="chevron-down" [size]="16" class="muted" />
    </button>

    @if (open()) {
      <div
        class="panel"
        role="dialog"
        [id]="panelId"
        aria-label="Choose categories"
      >
        <input
          uiInput
          type="search"
          placeholder="Find a category"
          aria-label="Find a category"
          [value]="search()"
          (input)="search.set(text($event))"
        />
        <p class="hint">
          <ui-icon name="info" [size]="14" />
          A category includes all its subcategories. With several, records in
          any of them are shown.
        </p>
        @if (store.confirmed.isLoading() && !rows().length) {
          <p class="muted small">Loading categories…</p>
        } @else if (store.confirmed.error()) {
          <p class="muted small">The categories could not be loaded.</p>
        } @else {
          <ul
            class="tree"
            role="tree"
            aria-label="Categories"
            aria-multiselectable="true"
          >
            @for (row of rows(); track row.key) {
              @if (row.kind === 'heading') {
                <li class="heading" role="presentation">{{ row.label }}</li>
              } @else {
                <li
                  class="node"
                  role="treeitem"
                  [attr.aria-level]="row.depth + 1"
                  [attr.aria-expanded]="row.hasChildren ? row.expanded : null"
                  [attr.aria-selected]="isSelected(row)"
                  [style.--depth]="row.depth"
                >
                  @if (row.hasChildren) {
                    <button
                      type="button"
                      class="expander"
                      [attr.aria-label]="
                        (row.expanded ? 'Collapse ' : 'Expand ') +
                        row.category.title
                      "
                      [disabled]="!!search().trim()"
                      (click)="toggleExpanded(row.category.id)"
                    >
                      <ui-icon
                        [name]="row.expanded ? 'chevron-down' : 'chevron-right'"
                        [size]="14"
                      />
                    </button>
                  } @else {
                    <span class="expander" aria-hidden="true"></span>
                  }
                  <label
                    class="option"
                    [class.option--included]="includedBy(row)"
                  >
                    <input
                      type="checkbox"
                      [checked]="isSelected(row) || !!includedBy(row)"
                      [disabled]="!!includedBy(row)"
                      (change)="select(row.category.id, checked($event))"
                    />
                    <span class="option__title">{{ row.category.title }}</span>
                    @if (includedBy(row); as parent) {
                      <span class="muted small">in {{ parent }}</span>
                    }
                    @if (countOf(row.category.id); as count) {
                      <span
                        class="count"
                        [attr.title]="
                          count.direct +
                          ' with this category' +
                          (count.total > count.direct
                            ? ', ' +
                              (count.total - count.direct) +
                              ' more in subcategories'
                            : '')
                        "
                        >{{ count.total }}</span
                      >
                    }
                  </label>
                </li>
              }
            } @empty {
              <li class="muted small">
                {{
                  search().trim()
                    ? 'No category matches.'
                    : 'No categories yet.'
                }}
              </li>
            }
          </ul>
        }
        <div class="footer">
          <button
            uiButton
            variant="ghost"
            size="sm"
            type="button"
            [disabled]="!value().length"
            (click)="value.set([])"
          >
            Clear
          </button>
          <button uiButton size="sm" type="button" (click)="close()">
            Done
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-width: 10rem;
    }
    .trigger {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      height: var(--control-height);
      padding: 0 var(--space-3);
      border: 1px solid var(--border-strong);
      border-radius: var(--control-radius);
      background: var(--surface-card);
      color: var(--text-primary);
      font: inherit;
      font-size: var(--text-sm);
      text-align: start;
      cursor: pointer;
    }
    .trigger[aria-expanded='true'] {
      border-color: var(--accent);
    }
    .trigger__value {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .trigger__value--empty {
      color: var(--text-muted);
    }
    .panel {
      position: absolute;
      z-index: var(--layer-popover);
      top: calc(100% + var(--space-1));
      inset-inline-start: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      width: min(24rem, 90vw);
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--control-radius);
      background: var(--surface-card);
      box-shadow: var(--shadow-popover);
    }
    .hint {
      display: flex;
      gap: var(--space-1);
      align-items: flex-start;
      margin: 0;
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
    .tree {
      max-height: 20rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .heading {
      padding: var(--space-2) var(--space-1) var(--space-1);
      color: var(--text-muted);
      font-size: var(--text-xs);
      font-weight: 600;
      text-transform: uppercase;
    }
    .node {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      padding-inline-start: calc(var(--depth, 0) * var(--space-4));
    }
    .expander {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: var(--space-6);
      height: var(--space-6);
      padding: 0;
      border: 0;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-muted);
      cursor: pointer;
    }
    button.expander:hover:not(:disabled) {
      background: var(--surface-hover);
    }
    .option {
      display: flex;
      flex: 1;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .option:hover {
      background: var(--surface-hover);
    }
    .option--included {
      color: var(--text-secondary);
      cursor: default;
    }
    .option__title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      margin-inline-start: auto;
      padding: 0 var(--space-2);
      border-radius: var(--radius-full);
      background: var(--surface-sunken);
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
    .footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    .muted {
      color: var(--text-muted);
    }
    .small {
      font-size: var(--text-xs);
    }
  `,
})
export class CategoryFilter {
  protected readonly store = inject(CategoryStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Selected category ids. */
  readonly value = model<string[]>([]);
  /** Records per category under the other filters; counts are hidden without them. */
  readonly counts = input<readonly CategoryCountDto[] | null>(null);
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });

  protected readonly panelId = `category-filter-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly search = signal('');
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  private readonly countById = computed(
    () => new Map((this.counts() ?? []).map((count) => [count.id, count])),
  );

  protected readonly rows = computed<CategoryRow[]>(() => {
    const text = this.search().trim();
    return categoryRows(
      this.store.hierarchy(),
      this.expanded(),
      text ? textMatch(text) : undefined,
    );
  });

  protected readonly summary = computed(() => {
    const ids = this.value();
    if (!ids.length) return 'Any category';
    if (ids.length > 1) return `${ids.length} categories`;
    const tree = this.store.hierarchy();
    const below = tree.descendants(ids[0]).length;
    const title = this.store.titleOf(ids[0]);
    return below ? `${title} + ${below} below` : title;
  });

  protected toggle(): void {
    if (this.open()) return this.close();
    // Open on the selection: expand the path to every selected category.
    const tree = this.store.hierarchy();
    const expanded = new Set(this.expanded());
    for (const id of this.value())
      for (const ancestor of tree.ancestors(id)) expanded.add(ancestor.id);
    this.expanded.set(expanded);
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
    this.search.set('');
  }

  protected toggleExpanded(id: string): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected isSelected(row: CategoryRow): boolean {
    return row.kind === 'category' && this.value().includes(row.key);
  }

  /** The title of a selected ancestor that already includes this category. */
  protected includedBy(row: CategoryRow): string | null {
    if (row.kind !== 'category') return null;
    const selected = this.value();
    const ancestor = this.store
      .hierarchy()
      .ancestors(row.key)
      .find((category) => selected.includes(category.id));
    return ancestor?.title ?? null;
  }

  /** Selecting a parent makes selected descendants redundant, so they are dropped. */
  protected select(id: string, checked: boolean): void {
    const tree = this.store.hierarchy();
    this.value.update((ids) => {
      if (!checked) return ids.filter((existing) => existing !== id);
      const below = new Set(
        tree.descendants(id).map((category) => category.id),
      );
      return [...ids.filter((existing) => !below.has(existing)), id];
    });
  }

  protected countOf(id: string): CategoryCountDto | undefined {
    return this.countById().get(id);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node))
      this.close();
  }
}
