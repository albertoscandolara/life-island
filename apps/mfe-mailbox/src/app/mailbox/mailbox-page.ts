import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  LETTER_KIND_LABELS,
  LETTER_STATUS_LABELS,
  type LetterDto,
  type LetterStatus,
  type MailboxOverviewDto,
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
import { MailboxApi } from '../api/mailbox-api';

const SERVICE = 'svc-mailbox';

const FIELDS: readonly LiField[] = [
  { key: 'receivedOn', label: 'Received on', type: 'date', required: true },
  { key: 'sender', label: 'From', type: 'text', required: true, placeholder: 'Agenzia delle Entrate, Comune di…' },
  { key: 'subject', label: 'Subject', type: 'text', required: true, wide: true },
  { key: 'text', label: 'The text', type: 'textarea', wide: true, hint: 'Paste or type it: the explainer reads it, and you can search it later' },
  { key: 'kind', label: 'Kind', type: 'select', options: liOptions(LETTER_KIND_LABELS), emptyLabel: 'Guess from the words' },
  { key: 'status', label: 'Status', type: 'select', required: true, options: liOptions(LETTER_STATUS_LABELS) },
  { key: 'amount', label: 'To pay', type: 'money' },
  { key: 'dueOn', label: 'Act by', type: 'date', hint: 'It shows in the Agenda' },
  { key: 'reference', label: 'Reference', type: 'text', placeholder: 'Protocol, notice or fine number' },
  { key: 'action', label: 'What I have to do', type: 'textarea', wide: true },
  { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

const URGENCY: Record<string, string> = { high: 'Urgent', medium: 'To handle', low: 'Information' };

/**
 * Admin mailbox (Diplo): the official letters you receive, what each one
 * means and asks, the date to act by, and an explainer that reads them.
 */
@Component({
  selector: 'mailbox-page',
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
  host: { 'data-character': 'diplo', class: 'mailbox' },
  templateUrl: './mailbox-page.html',
  styleUrl: './mailbox-page.css',
})
export class MailboxPage {
  private readonly api = inject(MailboxApi);

  protected readonly data = signal<MailboxOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<'open' | 'all'>('open');
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly explaining = signal(false);
  protected readonly explainStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly fields = FIELDS;
  protected readonly urgency = URGENCY;
  protected readonly letters = new RecordEditor(this.api, 'letters', () => this.load(), SERVICE);

  protected readonly shown = computed(() => {
    const text = this.search().trim().toLowerCase();
    return (this.data()?.letters ?? []).filter(
      (l) =>
        (this.filter() === 'all' || l.status === 'todo' || l.status === 'waiting') &&
        (!text || `${l.sender} ${l.subject} ${l.text ?? ''} ${l.reference ?? ''}`.toLowerCase().includes(text)),
    );
  });

  protected readonly selected = computed<LetterDto | null>(() => {
    const all = this.data()?.letters ?? [];
    return all.find((l) => l.id === this.selectedId()) ?? this.shown()[0] ?? null;
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
      error: (error: unknown) => this.error.set(errorText(error, 'Could not load your letters.', SERVICE)),
    });
  }

  protected kind(l: LetterDto): string {
    return LETTER_KIND_LABELS[l.kind];
  }

  protected status(s: LetterStatus): string {
    return LETTER_STATUS_LABELS[s];
  }

  protected add(): void {
    this.letters.add({ receivedOn: localToday(), status: 'todo' });
  }

  protected setStatus(l: LetterDto, status: LetterStatus): void {
    this.api.update('letters', l.id, { status }).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(errorText(error, 'Could not save it.', SERVICE)),
    });
  }

  protected explain(l: LetterDto): void {
    this.explaining.set(true);
    this.explainStatus.set('idle');
    this.api.explain(l.id).subscribe({
      next: () => {
        this.explaining.set(false);
        this.explainStatus.set('done');
        this.load();
      },
      error: (error: unknown) => {
        this.explaining.set(false);
        this.explainStatus.set('error');
        this.error.set(errorText(error, 'Could not explain the letter.', SERVICE));
      },
    });
  }

  protected apply(l: LetterDto): void {
    this.api.applyExplanation(l.id).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(errorText(error, 'Could not save it.', SERVICE)),
    });
  }

  /** Whether the explanation found something the letter does not have yet. */
  protected canApply(l: LetterDto): boolean {
    const out = l.explanation?.output;
    if (!out) return false;
    return (
      (l.kind === 'other' && out.kind !== 'other') ||
      (l.amount === null && out.amount > 0) ||
      (!l.dueOn && !!out.dueOn) ||
      (!l.action && out.actions.length > 0)
    );
  }
}
