import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  agendaArea,
  HIDDEN_AREAS_SETTING,
  type AgendaEntryDto,
  type AgendaOverviewDto,
} from '@life-island/contracts';
import { UiDialog, UiIcon } from '@life-island/design-system';
import { EntityDirectory } from '@life-island/entities-ui';
import {
  dayText,
  daysText,
  QUICK_ADD_KINDS,
  type QuickAddId,
} from '@life-island/records-ui';
import { BrowserSettings, hiddenAreas } from '@life-island/settings-ui';
import { catchError, of } from 'rxjs';
import { ISLAND_MODULES } from '../hub/modules';
import {
  areaItems,
  dateItems,
  entityItems,
  SEARCH_GROUP_LABELS,
  searchIsland,
  shortcutLabel,
  type SearchGroup,
  type SearchItem,
} from './search';

/** A line of the results: something to open, or something to add. */
type Row =
  | { type: 'open'; item: SearchItem }
  | { type: 'add'; id: QuickAddId; emblem: string; title: string };

/** How long the Agenda's dates are kept before search reads them again. */
const DATES_TTL_MS = 5 * 60_000;

/**
 * Search across the island: the areas and pages, the people, houses, cars
 * and companies of every area, and every date of the Agenda; arrows move,
 * Enter opens. What you typed can also be added as a reminder or to the
 * shopping list, so a search that finds nothing still ends in an action.
 */
@Component({
  selector: 'app-search-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiDialog, UiIcon],
  templateUrl: './search-dialog.html',
  styleUrl: './search-dialog.css',
})
export class SearchDialog {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly directory = inject(EntityDirectory);
  private readonly settings = inject(BrowserSettings);

  readonly open = model(false);
  /** Add what was typed: the shell opens that kind's form. */
  readonly add = output<{ id: QuickAddId; text: string }>();

  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly entries = signal<readonly AgendaEntryDto[]>([]);
  protected readonly datesLoading = signal(false);
  private datesRead = 0;

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('box');
  protected readonly listId = 'app-search-results';
  protected readonly shortcut = shortcutLabel();

  private readonly hidden = computed(() =>
    hiddenAreas(this.settings.value(HIDDEN_AREAS_SETTING)),
  );

  private readonly items = computed(() => [
    ...areaItems(ISLAND_MODULES, this.hidden()),
    ...entityItems(this.directory.entities()),
    ...dateItems(
      this.entries(),
      (e) => `${dayText(e.date)} · ${daysText(e.daysLeft)}`,
      agendaArea,
    ),
  ]);

  /** The open dates ahead, shown before you type. */
  private readonly next = computed(() =>
    dateItems(
      this.entries().filter((e) => !e.handled && e.daysLeft >= 0),
      (e) => `${dayText(e.date)} · ${daysText(e.daysLeft)}`,
      agendaArea,
    )
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5),
  );

  protected readonly groups = computed(() => {
    const text = this.query().trim();
    const found = text ? searchIsland(text, this.items()) : this.next();
    const groups: { label: string; rows: { row: Row; index: number }[] }[] = [];
    let index = 0;
    for (const item of found) {
      const label = text
        ? SEARCH_GROUP_LABELS[item.group as SearchGroup]
        : 'Coming up';
      let group = groups.find((g) => g.label === label);
      if (!group) groups.push((group = { label, rows: [] }));
      group.rows.push({ row: { type: 'open', item }, index: index++ });
    }
    if (text) {
      const adds = QUICK_ADD_KINDS.filter(
        (k) => k.textKey && !this.hidden().has(k.area),
      ).map((k) => ({
        row: {
          type: 'add' as const,
          id: k.id,
          emblem: k.emblem,
          title:
            k.id === 'reminder'
              ? `Add “${text}” as a reminder`
              : `Add “${text}” to the shopping list`,
        },
        index: index++,
      }));
      if (adds.length) groups.push({ label: 'Add it', rows: adds });
    }
    return groups;
  });

  private readonly rows = computed(() =>
    this.groups().flatMap((g) => g.rows.map((r) => r.row)),
  );

  protected readonly found = computed(
    () => this.rows().filter((r) => r.type === 'open').length,
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.query.set('');
        this.active.set(0);
        void this.directory.load();
        this.readDates();
      });
      // The dialog opens on the next frame; then the box takes the focus.
      requestAnimationFrame(() => this.input()?.nativeElement.focus());
    });
  }

  protected type(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  protected key(event: KeyboardEvent): void {
    const count = this.rows().length;
    if (!count) return;
    if (event.key === 'ArrowDown') this.active.update((i) => (i + 1) % count);
    else if (event.key === 'ArrowUp')
      this.active.update((i) => (i - 1 + count) % count);
    else if (event.key === 'Enter') this.choose(this.rows()[this.active()]);
    else return;
    event.preventDefault();
  }

  protected choose(row: Row | undefined): void {
    if (!row) return;
    this.open.set(false);
    if (row.type === 'add')
      this.add.emit({ id: row.id, text: this.query().trim() });
    else void this.router.navigateByUrl(row.item.path);
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  /** Reads the Agenda's dates, again when they are older than a few minutes. */
  private readDates(): void {
    if (this.datesLoading() || Date.now() - this.datesRead < DATES_TTL_MS)
      return;
    if (this.hidden().has('agenda')) return;
    this.datesLoading.set(true);
    this.http
      .get<AgendaOverviewDto>('/api/agenda/overview')
      .pipe(catchError(() => of(null)))
      .subscribe((overview) => {
        this.datesLoading.set(false);
        if (!overview) return;
        this.datesRead = Date.now();
        this.entries.set(overview.entries);
      });
  }
}
