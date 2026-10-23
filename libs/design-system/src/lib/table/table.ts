import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  Directive,
  inject,
  input,
  model,
  TemplateRef,
} from '@angular/core';
import { UiButton } from '../button/button';
import { UiIcon } from '../icon/icon';

export interface UiTableColumn {
  /** Property shown by default, and the name a `uiCell` template refers to. */
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'start' | 'center' | 'end';
  /** Any CSS width, e.g. `12rem` or `30%`. */
  width?: string;
  /** Hide the header text (still read by screen readers), e.g. for an actions column. */
  hideHeader?: boolean;
}

export interface UiTableSort {
  key: string;
  direction: 'asc' | 'desc';
}

export interface UiCellContext<T> {
  $implicit: T;
  row: T;
}

/**
 * Custom content for one column: `<ng-template uiCell="status" let-row>…</ng-template>`.
 * Columns without a template show `row[key]` as text.
 */
@Directive({ selector: 'ng-template[uiCell]' })
export class UiCellDef<T = unknown> {
  // The aliases give the short template syntax `uiCell="name"`.
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly column = input.required<string>({ alias: 'uiCell' });
  /** Only for type checking: `[uiCellOf]="rows()"` types `let-row`. */
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly rowsOf = input<readonly T[]>([], { alias: 'uiCellOf' });
  readonly template = inject<TemplateRef<UiCellContext<T>>>(TemplateRef);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static ngTemplateContextGuard<T>(
    _dir: UiCellDef<T>,
    ctx: unknown,
  ): ctx is UiCellContext<T> {
    return true;
  }
}

/**
 * Data table with sortable headers, custom cells, loading and empty states and
 * an optional pager. Sorting and paging are controlled: the table emits the
 * new `sort` / `page` and the caller fetches the rows.
 */
@Component({
  selector: 'ui-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, UiButton, UiIcon],
  templateUrl: './table.html',
  styleUrl: './table.css',
})
export class UiTable<T extends object> {
  readonly columns = input.required<readonly UiTableColumn[]>();
  readonly rows = input.required<readonly T[]>();
  /** Property that identifies a row, for stable rendering. */
  readonly rowKey = input<string>('id');
  readonly caption = input('');
  readonly loading = input(false);
  readonly emptyMessage = input('Nothing to show yet.');
  readonly sort = model<UiTableSort | null>(null);

  /** Zero-based page index; paging shows when `total` exceeds `pageSize`. */
  readonly page = model(0);
  readonly pageSize = input(20);
  readonly total = input<number | null>(null);

  private readonly cellDefs = contentChildren(UiCellDef);
  protected readonly templates = computed(
    () => new Map(this.cellDefs().map((def) => [def.column(), def.template])),
  );

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil((this.total() ?? 0) / this.pageSize())),
  );
  protected readonly rangeLabel = computed(() => {
    const total = this.total() ?? 0;
    if (total === 0) return '0 of 0';
    const first = this.page() * this.pageSize() + 1;
    const last = Math.min(total, first + this.pageSize() - 1);
    return `${first}–${last} of ${total}`;
  });

  protected keyOf(row: T, index: number): unknown {
    return (row as Record<string, unknown>)[this.rowKey()] ?? index;
  }

  protected valueOf(row: T, key: string): unknown {
    return (row as Record<string, unknown>)[key] ?? '';
  }

  protected ariaSort(column: UiTableColumn): string | null {
    if (!column.sortable) return null;
    const sort = this.sort();
    if (sort?.key !== column.key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected toggleSort(column: UiTableColumn): void {
    const sort = this.sort();
    const direction =
      sort?.key === column.key && sort.direction === 'desc' ? 'asc' : 'desc';
    this.sort.set({ key: column.key, direction });
    this.page.set(0);
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(0, page), this.pageCount() - 1));
  }
}
