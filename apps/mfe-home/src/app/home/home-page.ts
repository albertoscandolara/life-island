import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  WORK_KINDS,
  WORK_KIND_LABELS,
  WORK_STATUS_LABELS,
  type BillDto,
  type HomeDocumentDto,
  type PropertyDto,
  type WorkDto,
  type WorkKind,
  type WorkStatus,
} from '@life-island/contracts';
import { Router } from '@angular/router';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiConfirmDialog,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import type { UiTone } from '@life-island/design-system';
import { errorMessage, HomeApi } from '../api/home-api';
import { addMonths, aggregate, totalIn } from '../bills/aggregate';
import { ColumnChart, type ChartSeries } from '../charts/column-chart';
import { Sparkline } from '../charts/sparkline';
import { HousesView } from '../houses/houses-view';
import { AreaNav } from '../shared/area-nav';
import {
  addressOf,
  formatDate,
  formatEuro,
  formatEuroRound,
  formatTick,
  propertyColor,
} from '../shared/format';
import { PropertiesDialog } from '../shared/properties-dialog';
import { PropertyStore } from '../shared/property-store';
import { DocumentPicker } from './document-picker';
import { WorkDialog } from './work-dialog';

const STATUS_TONES: Record<WorkStatus, UiTone> = {
  PLANNED: 'info',
  IN_PROGRESS: 'progress',
  DONE: 'success',
};

const KIND_ICONS = {
  RENOVATION: 'home',
  REPAIR: 'wrench',
  MAINTENANCE: 'refresh',
  IMPROVEMENT: 'plus',
} as const;

/** What a work cost: the final cost once known, else the estimate. */
export const workCost = (work: WorkDto): number =>
  work.actualCost ?? work.estimatedCost ?? 0;

/** The year a work belongs to on the timeline; null while it has no dates. */
export const workYear = (work: WorkDto): number | null => {
  const day = work.startDate ?? work.endDate;
  return day ? Number(day.slice(0, 4)) : null;
};

/**
 * Bronto's Home: your properties side by side in 3D, and the renovations,
 * repairs and maintenance of each one, with what they cost and their invoices.
 */
@Component({
  selector: 'home-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiPageHeader,
    UiCard,
    UiButton,
    UiBadge,
    UiIcon,
    UiAlert,
    UiEmptyState,
    UiConfirmDialog,
    AreaNav,
    HousesView,
    ColumnChart,
    Sparkline,
    PropertiesDialog,
    WorkDialog,
    DocumentPicker,
  ],
  host: { 'data-character': 'bronto', class: 'home' },
  templateUrl: './home-page.html',
  styleUrls: ['../shared/kit.css', './home-page.css'],
})
export class HomePage {
  private readonly api = inject(HomeApi);
  protected readonly store = inject(PropertyStore);

  readonly property = input<string>();

  protected readonly works = signal<WorkDto[] | null>(null);
  protected readonly bills = signal<BillDto[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly managing = signal(false);
  protected readonly editing = signal<WorkDto | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly filing = signal<WorkDto | null>(null);
  protected readonly pickerOpen = signal(false);
  protected readonly removing = signal<WorkDto | null>(null);
  protected readonly status = signal<WorkStatus | 'ALL'>('ALL');

  private readonly router = inject(Router);

  protected readonly kinds = WORK_KINDS;
  protected readonly kindLabels = WORK_KIND_LABELS;
  protected readonly statusLabels = WORK_STATUS_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly formatEuro = formatEuro;
  protected readonly formatEuroRound = formatEuroRound;
  protected readonly formatDate = formatDate;
  protected readonly propertyColor = propertyColor;
  protected readonly addressOf = addressOf;
  protected readonly previewUrl = (id: string) => this.api.previewUrl(id);
  protected readonly label = (key: string) => key;

  protected readonly selected = computed(() => {
    const id = this.property();
    return this.store.properties()?.find((p) => p.id === id) ?? null;
  });

  private readonly last12 = computed(() => {
    const to = new Date().toISOString().slice(0, 7);
    return { from: addMonths(to, -11), to };
  });

  /** One card per home: its bills over the last year and its works. */
  protected readonly cards = computed(() =>
    (this.store.properties() ?? []).map((property) => {
      const bills = this.bills().filter((b) => b.propertyId === property.id);
      const works = (this.works() ?? []).filter(
        (w) => w.propertyId === property.id,
      );
      const trend = aggregate(bills, {
        range: this.last12(),
        grain: 'month',
        basis: 'period',
        metric: 'amount',
        keys: ['all'],
        keyOf: () => 'all',
      }).series[0].values;
      return {
        property,
        billsYear: totalIn(bills, this.last12(), 'period'),
        trend,
        open: works.filter((w) => w.status !== 'DONE').length,
        done: works.filter((w) => w.status === 'DONE').length,
        spent: works
          .filter((w) => w.status === 'DONE')
          .reduce((sum, w) => sum + workCost(w), 0),
      };
    }),
  );

  /** Works of the chosen home (or all) with the chosen status. */
  protected readonly visible = computed(() => {
    const property = this.selected();
    const status = this.status();
    return (this.works() ?? []).filter(
      (w) =>
        (!property || w.propertyId === property.id) &&
        (status === 'ALL' || w.status === status),
    );
  });

  /** The timeline: plans with no dates first, then year by year, newest first. */
  protected readonly timeline = computed(() => {
    const groups = new Map<string, WorkDto[]>();
    for (const work of this.visible()) {
      const year = workYear(work);
      const key = year === null ? 'Not scheduled yet' : String(year);
      groups.set(key, [...(groups.get(key) ?? []), work]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) =>
        a === 'Not scheduled yet'
          ? -1
          : b === 'Not scheduled yet'
            ? 1
            : b.localeCompare(a),
      )
      .map(([key, works]) => ({
        key,
        works,
        total: works.reduce((sum, w) => sum + workCost(w), 0),
      }));
  });

  protected readonly summary = computed(() => {
    const scoped = (this.works() ?? []).filter(
      (w) => !this.selected() || w.propertyId === this.selected()!.id,
    );
    const thisYear = new Date().getUTCFullYear();
    return {
      spent: scoped
        .filter((w) => w.status === 'DONE')
        .reduce((sum, w) => sum + (w.actualCost ?? w.estimatedCost ?? 0), 0),
      spentThisYear: scoped
        .filter((w) => w.status === 'DONE' && workYear(w) === thisYear)
        .reduce((sum, w) => sum + workCost(w), 0),
      budget: scoped
        .filter((w) => w.status !== 'DONE')
        .reduce((sum, w) => sum + (w.estimatedCost ?? 0), 0),
      open: scoped.filter((w) => w.status !== 'DONE').length,
      inProgress: scoped.filter((w) => w.status === 'IN_PROGRESS').length,
      documents: scoped.reduce((sum, w) => sum + w.documents.length, 0),
      count: scoped.length,
    };
  });

  /** What finished works cost, by year: one series per home (or one for the chosen home). */
  protected readonly spending = computed(() => {
    const homes = this.selected()
      ? [this.selected()!]
      : (this.store.properties() ?? []);
    const works = (this.works() ?? []).filter(
      (w) =>
        w.status === 'DONE' &&
        workYear(w) !== null &&
        homes.some((h) => h.id === w.propertyId),
    );
    const years = works.map((w) => workYear(w)!);
    if (!years.length) return null;
    const first = Math.min(...years);
    const last = Math.max(...years, new Date().getUTCFullYear());
    const buckets = Array.from({ length: last - first + 1 }, (_, i) =>
      String(first + i),
    );
    const series: ChartSeries[] = homes.map((home) => ({
      id: home.id,
      label: home.name,
      color: propertyColor(home.colorSlot),
      values: buckets.map((year) =>
        works
          .filter(
            (w) => w.propertyId === home.id && String(workYear(w)) === year,
          )
          .reduce((sum, w) => sum + workCost(w), 0),
      ),
    }));
    const max = Math.max(
      1,
      ...buckets.map((_, i) =>
        series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
      ),
    );
    return { buckets, series, format: (v: number) => formatTick(v, max) };
  });

  constructor() {
    this.load();
    this.api.bills().subscribe({
      next: (bills) => this.bills.set(bills),
      error: () => this.bills.set([]),
    });
  }

  /** Spent (done) or planned on each kind of work, for the chosen home. */
  protected kindTotal(kind: WorkKind): number {
    const property = this.selected();
    return (this.works() ?? [])
      .filter(
        (w) => w.kind === kind && (!property || w.propertyId === property.id),
      )
      .reduce((sum, w) => sum + workCost(w), 0);
  }

  protected choose(id: string): void {
    void this.router.navigate([], {
      queryParams: { property: id },
      queryParamsHandling: 'merge',
    });
  }

  protected home(id: string): PropertyDto | undefined {
    return this.store.properties()?.find((p) => p.id === id);
  }

  protected add(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  protected edit(work: WorkDto): void {
    this.editing.set(work);
    this.editorOpen.set(true);
  }

  protected onSaved(work: WorkDto): void {
    this.works.update((works) => {
      const list = works ?? [];
      return list.some((w) => w.id === work.id)
        ? list.map((w) => (w.id === work.id ? work : w))
        : [work, ...list];
    });
  }

  protected file(work: WorkDto): void {
    this.filing.set(work);
    this.pickerOpen.set(true);
  }

  protected onPicked(doc: HomeDocumentDto): void {
    const work = this.filing();
    if (!work) return;
    this.api.attachDocument(work.id, doc.uploadId).subscribe({
      next: (updated) => this.onSaved(updated),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected detach(work: WorkDto, uploadId: string): void {
    this.api.detachDocument(work.id, uploadId).subscribe({
      next: (updated) => this.onSaved(updated),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected setStatus(work: WorkDto, status: WorkStatus): void {
    this.api.updateWork(work.id, { status }).subscribe({
      next: (updated) => this.onSaved(updated),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected remove(): void {
    const work = this.removing();
    if (!work) return;
    this.api.deleteWork(work.id).subscribe({
      next: () => {
        this.works.update((works) =>
          (works ?? []).filter((w) => w.id !== work.id),
        );
        this.removing.set(null);
      },
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected dates(work: WorkDto): string {
    if (work.startDate && work.endDate)
      return work.startDate === work.endDate
        ? formatDate(work.startDate)
        : `${formatDate(work.startDate)} – ${formatDate(work.endDate)}`;
    if (work.startDate) return `Since ${formatDate(work.startDate)}`;
    if (work.endDate) return `Finished ${formatDate(work.endDate)}`;
    return 'No dates yet';
  }

  /** How the final cost compares with the estimate, 0..1.5, for the little bar. */
  protected budgetUse(work: WorkDto): number | null {
    if (!work.estimatedCost || work.actualCost === null) return null;
    return Math.min(1.5, work.actualCost / work.estimatedCost);
  }

  protected value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  private load(): void {
    this.api.works().subscribe({
      next: (works) => {
        this.error.set(null);
        this.works.set(works);
      },
      error: (error) => {
        this.works.set([]);
        this.error.set(errorMessage(error));
      },
    });
  }
}
