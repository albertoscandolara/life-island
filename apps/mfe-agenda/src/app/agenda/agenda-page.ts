import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AGENDA_CATEGORY_LABELS,
  AGENDA_REPEAT_LABELS,
  agendaArea,
  isoAddDays,
  type AgendaBriefDto,
  type AgendaEntryDto,
  type AgendaOverviewDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCalendarHeatmap,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import {
  AGENDA_ITEM_FIELDS,
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  dayText,
  errorText,
  euro,
  localToday,
  monthText,
  type LiTab,
  onRecordsChanged,
  urlTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { AgendaApi } from '../api/agenda-api';
import { CalendarCard } from './calendar-card';
import { DigestCard } from './digest-card';
import { EntryList } from './entry-list';
import { WaitingList } from './waiting-list';

type AgendaTab = 'now' | 'ahead' | 'items' | 'brief' | 'email';
const AGENDA_TABS: readonly AgendaTab[] = [
  'now',
  'ahead',
  'items',
  'brief',
  'email',
];
const SERVICE = 'svc-agenda';

/**
 * Agenda (Compy): every date of the island in one place. What is overdue and
 * this week, everything ahead month by month, your own items, and a week
 * brief that says what to do first.
 */
@Component({
  selector: 'agenda-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    CalendarCard,
    DigestCard,
    EntryList,
    WaitingList,
    LiRecordDialog,
    LiTabs,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCalendarHeatmap,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'compy', class: 'agenda' },
  templateUrl: './agenda-page.html',
  styleUrl: './agenda-page.css',
})
export class AgendaPage {
  private readonly api = inject(AgendaApi);

  protected readonly data = signal<AgendaOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = urlTab(AGENDA_TABS, 'now');
  /** The areas shown; empty shows all. */
  protected readonly areaFilter = signal<string | null>(null);
  protected readonly showHandled = signal(false);
  protected readonly itemFields = AGENDA_ITEM_FIELDS;
  protected readonly items = new RecordEditor(
    this.api,
    'items',
    () => this.load(),
    SERVICE,
  );
  protected readonly dateText = dateText;
  protected readonly monthText = monthText;
  protected readonly dayText = dayText;
  protected readonly area = agendaArea;

  // The week brief
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly briefStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownBrief = signal<string | null>(null);

  protected readonly entries = computed(() => {
    const data = this.data();
    if (!data) return [];
    const area = this.areaFilter();
    return data.entries.filter(
      (e) => (!area || e.module === area) && (this.showHandled() || !e.handled),
    );
  });

  /** What the areas wait on you for with no date, for the area shown. */
  protected readonly waiting = computed(() => {
    const area = this.areaFilter();
    return (this.data()?.waiting ?? []).filter(
      (w) => !area || w.module === area,
    );
  });

  protected readonly overdue = computed(() =>
    this.entries().filter((e) => e.daysLeft < 0),
  );
  protected readonly todayEntries = computed(() =>
    this.entries().filter((e) => e.daysLeft === 0),
  );
  protected readonly week = computed(() =>
    this.entries().filter((e) => e.daysLeft > 0 && e.daysLeft <= 7),
  );
  protected readonly month = computed(() =>
    this.entries().filter((e) => e.daysLeft > 7 && e.daysLeft <= 31),
  );

  /** Everything ahead, month by month. */
  protected readonly months = computed(() => {
    const groups = new Map<string, AgendaEntryDto[]>();
    for (const e of this.entries()) {
      if (e.daysLeft < 0) continue;
      const key = e.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    return [...groups.entries()].map(([month, entries]) => ({
      month,
      entries,
    }));
  });

  /** The year ahead as a calendar: how many dates each day holds. */
  protected readonly yearLoad = computed(() => {
    const today = this.data()?.today ?? localToday();
    const byDay = new Map<string, AgendaEntryDto[]>();
    for (const e of this.entries())
      if (e.daysLeft >= 0) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    const values: Record<string, number> = {};
    for (const [date, list] of byDay) values[date] = list.length;
    return {
      from: today,
      to: isoAddDays(today, 364),
      values,
      detail: (date: string) => {
        const list = byDay.get(date);
        if (!list) return null;
        const total = list.reduce((sum, e) => sum + (e.amount ?? 0), 0);
        const titles = list.slice(0, 3).map((e) => e.title);
        if (list.length > 3) titles.push(`${list.length - 3} more`);
        return [titles.join(', '), total ? euro(total) : null]
          .filter(Boolean)
          .join(' · ');
      },
    };
  });

  /** The areas that have dates, for the filter chips. */
  protected readonly areas = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.data()?.entries ?? [])
      if (!e.handled) counts.set(e.module, (counts.get(e.module) ?? 0) + 1);
    for (const w of this.data()?.waiting ?? [])
      counts.set(w.module, (counts.get(w.module) ?? 0) + 1);
    return [...counts.entries()]
      .map(([module, count]) => ({ module, count, ...agendaArea(module) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly unreachable = computed(
    () => this.data()?.sources.filter((s) => !s.ok) ?? [],
  );

  protected readonly counts = computed(() => {
    const open = (this.data()?.entries ?? []).filter((e) => !e.handled);
    return {
      overdue: open.filter((e) => e.daysLeft < 0).length,
      week: open.filter((e) => e.daysLeft >= 0 && e.daysLeft <= 7).length,
      month: open.filter((e) => e.daysLeft > 7 && e.daysLeft <= 31).length,
      year: open.filter((e) => e.daysLeft >= 0).length,
    };
  });

  protected readonly tabs = computed<LiTab[]>(() => [
    {
      id: 'now',
      label: 'Now',
      icon: 'alert',
      count:
        this.counts().overdue +
        this.counts().week +
        (this.data()?.waiting.length ?? 0),
    },
    { id: 'ahead', label: 'Year ahead', icon: 'calendar' },
    { id: 'items', label: 'My items', icon: 'edit' },
    { id: 'brief', label: 'Week brief', icon: 'sparkles' },
    { id: 'email', label: 'Email & calendar', icon: 'mail' },
  ]);

  protected readonly brief = computed<AgendaBriefDto | null>(() => {
    const briefs = this.data()?.briefs ?? [];
    return briefs.find((b) => b.id === this.shownBrief()) ?? briefs[0] ?? null;
  });

  constructor() {
    this.load();
    // Added from the island's "Add" menu while this page is open.
    onRecordsChanged(this.api.base, () => this.load());
  }

  protected readonly dayCount = (n: number) =>
    n === 1 ? '1 date' : `${n} dates`;

  /** A day of the calendar: its month's list, scrolled into view. */
  protected openMonth(date: string): void {
    document
      .getElementById(`month-${date.slice(0, 7)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not load your agenda.', SERVICE),
        ),
    });
  }

  protected toggle(entry: AgendaEntryDto): void {
    // Show it at once, then confirm with the service.
    this.data.update((data) =>
      data
        ? {
            ...data,
            entries: data.entries.map((e) =>
              e.key === entry.key ? { ...e, handled: !e.handled } : e,
            ),
          }
        : data,
    );
    this.api.setHandled(entry.key, !entry.handled).subscribe({
      next: () => this.load(),
      error: (error: unknown) => {
        this.error.set(errorText(error, 'Could not save it.', SERVICE));
        this.load();
      },
    });
  }

  protected editEntry(entry: AgendaEntryDto): void {
    const item = this.data()?.items.find((i) => i.id === entry.itemId);
    if (item) this.items.edit(item);
  }

  protected addItem(): void {
    this.items.add({
      date: localToday(),
      repeat: 'none',
      category: 'personal',
    });
  }

  protected repeatLabel(repeat: string): string {
    return (
      AGENDA_REPEAT_LABELS[repeat as keyof typeof AGENDA_REPEAT_LABELS] ??
      repeat
    );
  }

  protected categoryLabel(category: string): string {
    return (
      AGENDA_CATEGORY_LABELS[category as keyof typeof AGENDA_CATEGORY_LABELS] ??
      category
    );
  }

  protected ask(): void {
    this.asking.set(true);
    this.briefStatus.set('idle');
    this.api
      .writeBrief({ question: this.question().trim() || null })
      .subscribe({
        next: (brief) => {
          this.asking.set(false);
          this.briefStatus.set('done');
          this.shownBrief.set(brief.id);
          this.question.set('');
          this.load();
        },
        error: (error: unknown) => {
          this.asking.set(false);
          this.briefStatus.set('error');
          this.error.set(
            errorText(error, 'Could not write the brief.', SERVICE),
          );
        },
      });
  }

  protected removeBrief(id: string): void {
    this.api.removeBrief(id).subscribe({
      next: () => {
        this.shownBrief.set(null);
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }
}
