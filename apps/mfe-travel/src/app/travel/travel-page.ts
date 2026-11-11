import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  BOOKING_KIND_LABELS,
  TRAVEL_EXPENSE_LABELS,
  TRIP_STATUS_LABELS,
  type BookingKind,
  type ChecklistItemDto,
  type TravelExpenseCategory,
  type TravelOverviewDto,
  type TripDto,
  type TripPlanDto,
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
  RecordEditor,
  dateText,
  errorText,
  euro,
  liOptions,
  localToday,
  type LiField,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { TravelApi } from '../api/travel-api';

const SERVICE = 'svc-travel';

const TRIP_FIELDS: readonly LiField[] = [
  { key: 'title', label: 'Trip', type: 'text', required: true, placeholder: 'Summer in Puglia, Lisbon weekend…' },
  { key: 'destination', label: 'Where', type: 'text', required: true },
  { key: 'startOn', label: 'From', type: 'date' },
  { key: 'endOn', label: 'To', type: 'date' },
  { key: 'travellers', label: 'Travellers', type: 'number', min: 1, max: 50 },
  { key: 'budget', label: 'Budget', type: 'money' },
  { key: 'status', label: 'Status', type: 'select', required: true, options: liOptions(TRIP_STATUS_LABELS) },
  { key: 'abroad', label: 'Outside the Schengen area (passport, visa)', type: 'checkbox', wide: true },
  { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const BOOKING_FIELDS: readonly LiField[] = [
  { key: 'kind', label: 'Kind', type: 'select', required: true, options: liOptions(BOOKING_KIND_LABELS) },
  { key: 'title', label: 'What', type: 'text', required: true, placeholder: 'Flight MXP → LIS, Hotel Alfama…' },
  { key: 'provider', label: 'With', type: 'text', placeholder: 'Ryanair, Booking.com…' },
  { key: 'reference', label: 'Booking code', type: 'text' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'time', label: 'Time', type: 'text', placeholder: '08:40, check-in from 15:00' },
  { key: 'cost', label: 'Cost', type: 'money' },
  { key: 'cancelBy', label: 'Free cancellation until', type: 'date', hint: 'It shows in the Agenda' },
  { key: 'paid', label: 'Paid', type: 'checkbox' },
  { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const CHECK_FIELDS: readonly LiField[] = [
  { key: 'text', label: 'What', type: 'text', required: true, wide: true },
  { key: 'dueOn', label: 'By', type: 'date' },
  { key: 'packing', label: 'To pack', type: 'checkbox' },
  { key: 'done', label: 'Done', type: 'checkbox' },
];

const EXPENSE_FIELDS: readonly LiField[] = [
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'amount', label: 'Amount', type: 'money', required: true },
  { key: 'category', label: 'For', type: 'select', required: true, options: liOptions(TRAVEL_EXPENSE_LABELS) },
  { key: 'note', label: 'Note', type: 'text' },
];

const ICONS: Record<BookingKind, string> = {
  flight: '✈️',
  train: '🚆',
  bus: '🚌',
  ferry: '⛴️',
  car: '🚗',
  stay: '🏨',
  activity: '🎟️',
  insurance: '🛡️',
  other: '📌',
};

/**
 * Travel (Quetzal): every trip with its bookings, what to do before
 * leaving, what to pack and what you spend, and a planner that prepares it.
 */
@Component({
  selector: 'travel-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    LiDue,
    LiRecordDialog,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'quetzal', class: 'travel' },
  templateUrl: './travel-page.html',
  styleUrl: './travel-page.css',
})
export class TravelPage {
  private readonly api = inject(TravelApi);

  protected readonly data = signal<TravelOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly dateText = dateText;
  protected readonly euro = euro;
  protected readonly icons = ICONS;
  protected readonly tripFields = TRIP_FIELDS;
  protected readonly bookingFields = BOOKING_FIELDS;
  protected readonly checkFields = CHECK_FIELDS;
  protected readonly expenseFields = EXPENSE_FIELDS;

  protected readonly trips = new RecordEditor(this.api, 'trips', () => this.load(), SERVICE);
  protected readonly bookings = new RecordEditor(this.api, 'bookings', () => this.load(), SERVICE, ['tripId']);
  protected readonly checklist = new RecordEditor(this.api, 'checklist', () => this.load(), SERVICE, ['tripId']);
  protected readonly expenses = new RecordEditor(this.api, 'expenses', () => this.load(), SERVICE, ['tripId']);

  protected readonly newTask = signal('');
  protected readonly newPack = signal('');
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly planStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly applied = signal<string | null>(null);

  protected readonly selected = computed<TripDto | null>(() => {
    const all = this.data()?.trips ?? [];
    return all.find((t) => t.id === this.selectedId()) ?? all[0] ?? null;
  });

  protected readonly todo = computed(() => (this.selected()?.checklist ?? []).filter((c) => !c.packing));
  protected readonly packing = computed(() => (this.selected()?.checklist ?? []).filter((c) => c.packing));

  protected readonly plan = computed<TripPlanDto | null>(() => {
    const trip = this.selected();
    return trip ? ((this.data()?.plans ?? []).find((p) => p.tripId === trip.id) ?? null) : null;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
      },
      error: (error: unknown) => this.error.set(errorText(error, 'Could not load your trips.', SERVICE)),
    });
  }

  protected status(t: TripDto): string {
    return TRIP_STATUS_LABELS[t.status];
  }

  protected expenseLabel(c: TravelExpenseCategory): string {
    return TRAVEL_EXPENSE_LABELS[c];
  }

  protected addTrip(): void {
    this.trips.add({ status: 'planning', travellers: 1, abroad: false });
  }

  protected quickAdd(trip: TripDto, packing: boolean): void {
    const text = (packing ? this.newPack() : this.newTask()).trim();
    if (!text) return;
    (packing ? this.newPack : this.newTask).set('');
    this.api.create('checklist', { tripId: trip.id, text, packing }).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(errorText(error, 'Could not add it.', SERVICE)),
    });
  }

  protected toggle(item: ChecklistItemDto): void {
    this.data.update((d) =>
      d
        ? {
            ...d,
            trips: d.trips.map((t) =>
              t.id === item.tripId
                ? { ...t, checklist: t.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)) }
                : t,
            ),
          }
        : d,
    );
    this.api.update('checklist', item.id, { done: !item.done }).subscribe({
      error: (error: unknown) => {
        this.error.set(errorText(error, 'Could not save it.', SERVICE));
        this.load();
      },
    });
  }

  protected addExpense(trip: TripDto): void {
    this.expenses.add({ tripId: trip.id, date: localToday(), category: 'food' });
  }

  protected ask(trip: TripDto): void {
    this.asking.set(true);
    this.planStatus.set('idle');
    this.applied.set(null);
    this.api.plan(trip.id, { question: this.question().trim() || null }).subscribe({
      next: () => {
        this.asking.set(false);
        this.planStatus.set('done');
        this.question.set('');
        this.load();
      },
      error: (error: unknown) => {
        this.asking.set(false);
        this.planStatus.set('error');
        this.error.set(errorText(error, 'Could not plan the trip.', SERVICE));
      },
    });
  }

  protected apply(plan: TripPlanDto, checklist: boolean, packing: boolean): void {
    this.api.applyPlan(plan.id, { checklist, packing }).subscribe({
      next: ({ added }) => {
        this.applied.set(added ? `${added} item${added === 1 ? '' : 's'} added to the trip.` : 'They are all on the trip already.');
        this.load();
      },
      error: (error: unknown) => this.error.set(errorText(error, 'Could not add them.', SERVICE)),
    });
  }

  protected removePlan(id: string): void {
    this.api.removePlan(id).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }
}
