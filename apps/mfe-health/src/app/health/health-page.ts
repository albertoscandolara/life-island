import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  isoDaysBetween,
  SUGGESTED_CHECKUPS,
  VISIT_KIND_LABELS,
  type CheckupDto,
  type HealthOverviewDto,
  type ResultsExplanationDto,
  type TestSeriesDto,
  type VisitKind,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import {
  LiDue,
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  errorText,
  euro,
  liOptions,
  localToday,
  type LiField,
  type LiTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { HealthApi } from '../api/health-api';

type HealthTab =
  'checkups' | 'visits' | 'medicines' | 'results' | 'vaccinations' | 'explain';
const TABS: readonly HealthTab[] = [
  'checkups',
  'visits',
  'medicines',
  'results',
  'vaccinations',
  'explain',
];
const SERVICE = 'svc-health';

const PERSON: LiField = {
  key: 'person',
  label: 'Who',
  type: 'text',
  required: true,
  placeholder: 'Your name, or a family member',
};

const VISIT_FIELDS: readonly LiField[] = [
  { key: 'date', label: 'Date', type: 'date', required: true },
  PERSON,
  {
    key: 'kind',
    label: 'Kind',
    type: 'select',
    required: true,
    options: liOptions(VISIT_KIND_LABELS),
  },
  { key: 'doctor', label: 'Doctor or place', type: 'text' },
  { key: 'reason', label: 'Why', type: 'text', wide: true },
  { key: 'outcome', label: 'What they said', type: 'textarea', wide: true },
  { key: 'cost', label: 'Cost', type: 'money' },
  {
    key: 'followUpOn',
    label: 'Follow-up on',
    type: 'date',
    hint: 'It shows in the Agenda',
  },
  {
    key: 'deductible',
    label: 'Deductible in the 730 (keep the receipt)',
    type: 'checkbox',
    wide: true,
  },
];

const MEDICINE_FIELDS: readonly LiField[] = [
  PERSON,
  { key: 'name', label: 'Medicine', type: 'text', required: true },
  { key: 'dose', label: 'Dose', type: 'text', placeholder: '1 tablet, 5 ml…' },
  {
    key: 'schedule',
    label: 'When',
    type: 'text',
    placeholder: 'In the morning, after meals…',
  },
  { key: 'startOn', label: 'From', type: 'date' },
  { key: 'endOn', label: 'Until', type: 'date' },
  {
    key: 'refillOn',
    label: 'Runs out on',
    type: 'date',
    hint: 'A reminder shows in the Agenda',
  },
  { key: 'active', label: 'Taking it now', type: 'checkbox' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const RESULT_FIELDS: readonly LiField[] = [
  { key: 'date', label: 'Date of the test', type: 'date', required: true },
  PERSON,
  {
    key: 'test',
    label: 'Test',
    type: 'text',
    required: true,
    placeholder: 'Total cholesterol, glucose, TSH…',
  },
  { key: 'value', label: 'Value', type: 'number', required: true },
  { key: 'unit', label: 'Unit', type: 'text', placeholder: 'mg/dL' },
  {
    key: 'low',
    label: 'Range from',
    type: 'number',
    hint: 'As printed on the report',
  },
  { key: 'high', label: 'Range to', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const VACCINATION_FIELDS: readonly LiField[] = [
  PERSON,
  {
    key: 'name',
    label: 'Vaccine',
    type: 'text',
    required: true,
    placeholder: 'Tetanus, flu, COVID-19…',
  },
  { key: 'date', label: 'Given on', type: 'date', required: true },
  {
    key: 'nextDueOn',
    label: 'Next dose on',
    type: 'date',
    hint: 'Tetanus: every 10 years',
  },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const CHECKUP_FIELDS: readonly LiField[] = [
  PERSON,
  { key: 'name', label: 'Checkup', type: 'text', required: true },
  {
    key: 'everyMonths',
    label: 'Every (months)',
    type: 'number',
    required: true,
    min: 1,
    max: 240,
  },
  { key: 'lastDoneOn', label: 'Last done', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

/**
 * Health (Maia): visits, medicines, test results over time, vaccinations
 * and the checkups to repeat, for you and your family, and an explainer
 * for your results.
 */
@Component({
  selector: 'health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    LiDue,
    LiRecordDialog,
    LiTabs,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'maia', class: 'health' },
  templateUrl: './health-page.html',
  styleUrl: './health-page.css',
})
export class HealthPage {
  private readonly api = inject(HealthApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<HealthOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<string>(this.initialTab());
  protected readonly person = signal<string | null>(null);
  protected readonly dateText = dateText;
  protected readonly euro = euro;
  protected readonly suggested = SUGGESTED_CHECKUPS;
  protected readonly visitFields = VISIT_FIELDS;
  protected readonly medicineFields = MEDICINE_FIELDS;
  protected readonly resultFields = RESULT_FIELDS;
  protected readonly vaccinationFields = VACCINATION_FIELDS;
  protected readonly checkupFields = CHECKUP_FIELDS;

  protected readonly visits = new RecordEditor(
    this.api,
    'visits',
    () => this.load(),
    SERVICE,
  );
  protected readonly medicines = new RecordEditor(
    this.api,
    'medicines',
    () => this.load(),
    SERVICE,
  );
  protected readonly results = new RecordEditor(
    this.api,
    'results',
    () => this.load(),
    SERVICE,
  );
  protected readonly vaccinations = new RecordEditor(
    this.api,
    'vaccinations',
    () => this.load(),
    SERVICE,
  );
  protected readonly checkups = new RecordEditor(
    this.api,
    'checkups',
    () => this.load(),
    SERVICE,
  );

  // The explainer
  protected readonly explainFor = signal<string | null>(null);
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly explainStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownExplanation = signal<string | null>(null);

  private readonly mine = <T extends { person: string }>(
    list: readonly T[],
  ) => {
    const p = this.person();
    return p ? list.filter((r) => r.person === p) : [...list];
  };

  protected readonly shownVisits = computed(() =>
    this.mine(this.data()?.visits ?? []),
  );
  protected readonly shownMedicines = computed(() =>
    this.mine(this.data()?.medicines ?? []),
  );
  protected readonly shownSeries = computed(() =>
    this.mine(this.data()?.series ?? []),
  );
  protected readonly shownVaccinations = computed(() =>
    this.mine(this.data()?.vaccinations ?? []),
  );
  protected readonly shownCheckups = computed(() =>
    this.mine(this.data()?.checkups ?? []),
  );

  protected readonly activeMedicines = computed(
    () => (this.data()?.medicines ?? []).filter((m) => m.active).length,
  );

  protected readonly tabs = computed<LiTab[]>(() => {
    const d = this.data();
    return [
      {
        id: 'checkups',
        label: 'Checkups',
        icon: 'calendar',
        count: d?.checkups.filter((c) => c.overdue).length,
      },
      { id: 'visits', label: 'Visits', icon: 'file' },
      { id: 'medicines', label: 'Medicines', icon: 'droplet' },
      {
        id: 'results',
        label: 'Results',
        icon: 'chart',
        count: d?.series.filter(
          (s) => this.flag(s) !== 'normal' && this.flag(s) !== 'unknown',
        ).length,
      },
      { id: 'vaccinations', label: 'Vaccinations', icon: 'check' },
      { id: 'explain', label: 'Explain', icon: 'sparkles' },
    ];
  });

  protected readonly explanation = computed<ResultsExplanationDto | null>(
    () => {
      const all = this.data()?.explanations ?? [];
      return (
        all.find((e) => e.id === this.shownExplanation()) ?? all[0] ?? null
      );
    },
  );

  constructor() {
    this.load();
  }

  private initialTab(): HealthTab {
    const tab = this.route.snapshot.queryParamMap.get(
      'tab',
    ) as HealthTab | null;
    return tab && TABS.includes(tab) ? tab : 'checkups';
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'checkups' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not load your health records.', SERVICE),
        ),
    });
  }

  /** Defaults for a new record: the person shown, or the only one there is. */
  protected who(): string | undefined {
    const people = this.data()?.people ?? [];
    return this.person() ?? (people.length === 1 ? people[0] : undefined);
  }

  protected kind(kind: VisitKind): string {
    return VISIT_KIND_LABELS[kind];
  }

  protected days(date: string): number {
    return isoDaysBetween(this.data()?.today ?? localToday(), date);
  }

  protected flag(s: TestSeriesDto): string {
    return s.points[s.points.length - 1]?.flag ?? 'unknown';
  }

  protected range(s: { low: number | null; high: number | null }): string {
    if (s.low === null && s.high === null) return '';
    if (s.low === null) return `< ${s.high}`;
    if (s.high === null) return `> ${s.low}`;
    return `${s.low}–${s.high}`;
  }

  protected markDone(c: CheckupDto): void {
    this.api
      .update('checkups', c.id, {
        lastDoneOn: this.data()?.today ?? localToday(),
      })
      .subscribe({
        next: () => this.load(),
        error: (error: unknown) =>
          this.error.set(errorText(error, 'Could not save it.', SERVICE)),
      });
  }

  protected addSuggested(name: string, everyMonths: number): void {
    this.checkups.add({ person: this.who(), name, everyMonths });
  }

  protected addResultLike(s: TestSeriesDto): void {
    this.results.add({
      person: s.person,
      test: s.test,
      unit: s.unit,
      low: s.low,
      high: s.high,
      date: localToday(),
    });
  }

  protected explain(): void {
    this.asking.set(true);
    this.explainStatus.set('idle');
    this.api
      .explain({
        person: this.explainFor(),
        question: this.question().trim() || null,
      })
      .subscribe({
        next: (answer) => {
          this.asking.set(false);
          this.explainStatus.set('done');
          this.shownExplanation.set(answer.id);
          this.question.set('');
          this.load();
        },
        error: (error: unknown) => {
          this.asking.set(false);
          this.explainStatus.set('error');
          this.error.set(
            errorText(error, 'Could not explain the results.', SERVICE),
          );
        },
      });
  }

  protected removeExplanation(id: string): void {
    this.api.removeExplanation(id).subscribe({
      next: () => {
        this.shownExplanation.set(null);
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }
}
