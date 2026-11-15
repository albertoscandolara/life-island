import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  pensionDeductionLimit,
  PENSION_FUND_KIND_LABELS,
  PENSION_FUND_KINDS,
  PENSION_PAYMENT_KIND_LABELS,
  PENSION_PAYMENT_KINDS,
  type PendingPensionStatementDto,
  type PensionFundDto,
  type PensionFundKind,
  type PensionFundRequest,
  type PensionOverviewDto,
  type PensionPaymentKind,
  type PensionPaymentRequest,
  type PensionStatementRequest,
  type PensionYearDto,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiProgressBar,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { WorkApi } from '../api/work-api';
import { euro, parseAmount, periodText, safeUrl } from './labels';
import { guideText, PENSION_GUIDE } from './pension-guide';

/** A fund as you type it. */
export interface FundDraft {
  /** The fund being edited; null adds one. */
  id: string | null;
  name: string;
  kind: PensionFundKind;
  memberSince: string;
  investmentLine: string;
  employeePct: string;
  employerPct: string;
  tfrPct: string;
  firstJob: boolean;
  memberCode: string;
  url: string;
  notes: string;
  active: boolean;
}

export interface StatementDraft {
  fundId: string;
  date: string;
  value: string;
  paidIn: string;
  employee: string;
  employer: string;
  tfr: string;
  returnPct: string;
}

export interface PaymentDraft {
  fundId: string;
  date: string;
  amount: string;
  kind: PensionPaymentKind;
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function text(value: string): string | null {
  return value.trim() || null;
}

/** A percentage as typed ("1,2", "2%"), or null. */
export function percentOf(raw: string): number | null {
  const value = Number(raw.replace(',', '.').replace('%', '').trim());
  return raw.trim() && Number.isFinite(value) ? value : null;
}

export function fundRequest(draft: FundDraft): PensionFundRequest {
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    memberSince: draft.memberSince || null,
    investmentLine: text(draft.investmentLine),
    employeePct: percentOf(draft.employeePct),
    employerPct: percentOf(draft.employerPct),
    tfrPct: percentOf(draft.tfrPct),
    firstJob: draft.firstJob,
    memberCode: text(draft.memberCode),
    url: text(draft.url),
    notes: text(draft.notes),
    status: draft.active ? 'active' : 'closed',
  };
}

/** The statement request, or null while the date or the value is missing. */
export function statementRequest(
  draft: StatementDraft,
): PensionStatementRequest | null {
  const value = parseAmount(draft.value);
  if (!draft.fundId || !draft.date || value === null) return null;
  return {
    fundId: draft.fundId,
    date: draft.date,
    value,
    paidIn: parseAmount(draft.paidIn),
    employee: parseAmount(draft.employee),
    employer: parseAmount(draft.employer),
    tfr: parseAmount(draft.tfr),
    returnPct: percentOf(draft.returnPct),
  };
}

export function paymentRequest(
  draft: PaymentDraft,
): PensionPaymentRequest | null {
  const amount = parseAmount(draft.amount);
  if (!draft.fundId || !draft.date || amount === null || amount <= 0)
    return null;
  return {
    fundId: draft.fundId,
    date: draft.date,
    amount,
    kind: draft.kind,
    note: text(draft.note),
  };
}

/**
 * Pension fund: how a fondo pensione works in plain words, your funds, what
 * your payslips and your own transfers paid in year by year against the
 * deduction limit, the value of your position from its statements, and what
 * the 730 and the fund need from you.
 */
@Component({
  selector: 'work-pension',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiEmptyState, UiIcon, UiProgressBar],
  templateUrl: './pension-tab.html',
  styleUrls: ['./blocks.css', './pension-tab.css'],
})
export class PensionTab {
  readonly pension = input.required<PensionOverviewDto>();
  readonly changed = output<void>();
  /** Opens the TFR tab, with the company-or-fund comparison. */
  readonly showTfr = output<void>();

  private readonly api = inject(WorkApi);

  protected readonly euro = euro;
  protected readonly periodText = periodText;
  protected readonly safeUrl = safeUrl;
  protected readonly kinds = PENSION_FUND_KINDS;
  protected readonly kindLabels = PENSION_FUND_KIND_LABELS;
  protected readonly paymentKinds = PENSION_PAYMENT_KINDS;
  protected readonly paymentKindLabels = PENSION_PAYMENT_KIND_LABELS;
  protected readonly guide = PENSION_GUIDE;

  protected readonly fundDraft = signal<FundDraft | null>(null);
  protected readonly statementDraft = signal<StatementDraft | null>(null);
  protected readonly paymentDraft = signal<PaymentDraft | null>(null);
  /** The year whose notice date is being typed, and the date. */
  protected readonly noticeDraft = signal<{
    year: number;
    date: string;
  } | null>(null);
  /** Which pending statement goes under which fund ('' makes a new one). */
  protected readonly pendingFund = signal<Record<string, string>>({});
  protected readonly removing = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly limits = computed(() => ({
    limit: euro(this.pension().limit),
    oldLimit: euro(pensionDeductionLimit(2025)),
  }));
  protected readonly funds = computed(() => this.pension().funds);
  protected readonly activeFunds = computed(() =>
    this.funds().filter((f) => f.status === 'active'),
  );
  /** Nothing on record yet: the guide comes first. */
  protected readonly newcomer = computed(
    () => !this.funds().length && !this.pension().onPayslips,
  );
  /** The longest membership, for the exit tax tile. */
  protected readonly longest = computed(
    () =>
      [...this.funds()]
        .filter((f) => f.yearsMember !== null)
        .sort((a, b) => (b.yearsMember ?? 0) - (a.yearsMember ?? 0))[0] ?? null,
  );
  protected readonly gain = computed(() => {
    const p = this.pension();
    const valued = p.funds.filter((f) => f.value !== null && f.paidIn !== null);
    if (!valued.length) return null;
    return valued.reduce((s, f) => s + (f.gain ?? 0), 0);
  });
  protected readonly usedPct = computed(() => {
    const t = this.pension().thisYear;
    return t ? Math.round((t.counted / t.limit) * 100) : null;
  });
  protected readonly projectedPct = computed(() => {
    const t = this.pension().thisYear;
    return t ? Math.round((t.projected / t.limit) * 100) : null;
  });

  protected text(value: string): string {
    return guideText(value, this.limits());
  }

  protected fundName(id: string | null): string {
    return this.funds().find((f) => f.id === id)?.name ?? '';
  }

  // ---- funds ---------------------------------------------------------------

  protected startFund(fund?: PensionFundDto): void {
    this.error.set(null);
    this.fundDraft.set(
      fund
        ? {
            id: fund.id,
            name: fund.name,
            kind: fund.kind,
            memberSince: fund.memberSince ?? '',
            investmentLine: fund.investmentLine ?? '',
            employeePct: fund.employeePct?.toString() ?? '',
            employerPct: fund.employerPct?.toString() ?? '',
            tfrPct: fund.tfrPct?.toString() ?? '',
            firstJob: fund.firstJob,
            memberCode: fund.memberCode ?? '',
            url: fund.url ?? '',
            notes: fund.notes ?? '',
            active: fund.status === 'active',
          }
        : {
            id: null,
            name: '',
            kind: 'negotiated',
            memberSince: '',
            investmentLine: '',
            employeePct: '',
            employerPct: '',
            tfrPct: '100',
            firstJob: false,
            memberCode: '',
            url: '',
            notes: '',
            active: true,
          },
    );
  }

  protected setFund(change: Partial<FundDraft>): void {
    this.fundDraft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected saveFund(): void {
    const draft = this.fundDraft();
    if (!draft?.name.trim()) return;
    const request = fundRequest(draft);
    this.run(
      draft.id ?? 'new-fund',
      () =>
        draft.id
          ? this.api.updateFund(draft.id, request)
          : this.api.addFund(request),
      () => this.fundDraft.set(null),
    );
  }

  protected removeFund(fund: PensionFundDto): void {
    this.run(
      fund.id,
      () => this.api.removeFund(fund.id),
      () => this.removing.set(null),
    );
  }

  // ---- statements ----------------------------------------------------------

  protected startStatement(): void {
    this.error.set(null);
    this.statementDraft.set({
      fundId: this.activeFunds()[0]?.id ?? this.funds()[0]?.id ?? '',
      date: `${new Date().getFullYear() - 1}-12-31`,
      value: '',
      paidIn: '',
      employee: '',
      employer: '',
      tfr: '',
      returnPct: '',
    });
  }

  protected setStatement(change: Partial<StatementDraft>): void {
    this.statementDraft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected saveStatement(): void {
    const draft = this.statementDraft();
    const request = draft ? statementRequest(draft) : null;
    if (!request) return;
    this.run(
      'new-statement',
      () => this.api.addStatement(request),
      () => this.statementDraft.set(null),
    );
  }

  protected removeStatement(id: string): void {
    this.run(
      id,
      () => this.api.removeStatement(id),
      () => this.removing.set(null),
    );
  }

  protected pendingChoice(p: PendingPensionStatementDto): string {
    return this.pendingFund()[p.uploadId] ?? p.fundId ?? '';
  }

  protected choosePending(uploadId: string, fundId: string): void {
    this.pendingFund.update((m) => ({ ...m, [uploadId]: fundId }));
  }

  protected confirm(p: PendingPensionStatementDto): void {
    const fundId = this.pendingChoice(p) || null;
    this.run(p.uploadId, () =>
      this.api.confirmStatement(p.uploadId, { fundId }),
    );
  }

  protected dismiss(p: PendingPensionStatementDto): void {
    this.run(p.uploadId, () => this.api.dismissStatement(p.uploadId));
  }

  // ---- payments ------------------------------------------------------------

  protected startPayment(amount?: number): void {
    this.error.set(null);
    this.paymentDraft.set({
      fundId: this.activeFunds()[0]?.id ?? this.funds()[0]?.id ?? '',
      date: today(),
      amount: amount ? String(Math.floor(amount)) : '',
      kind: 'direct',
      note: '',
    });
  }

  protected setPayment(change: Partial<PaymentDraft>): void {
    this.paymentDraft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected savePayment(): void {
    const draft = this.paymentDraft();
    const request = draft ? paymentRequest(draft) : null;
    if (!request) return;
    this.run(
      'new-payment',
      () => this.api.addPayment(request),
      () => this.paymentDraft.set(null),
    );
  }

  protected removePayment(id: string): void {
    this.run(
      id,
      () => this.api.removePayment(id),
      () => this.removing.set(null),
    );
  }

  // ---- notices -------------------------------------------------------------

  protected startNotice(year: PensionYearDto): void {
    this.noticeDraft.set({ year: year.year, date: today() });
  }

  protected saveNotice(): void {
    const draft = this.noticeDraft();
    if (!draft?.date) return;
    this.run(
      `notice-${draft.year}`,
      () => this.api.setNotice(draft.year, { sentAt: draft.date }),
      () => this.noticeDraft.set(null),
    );
  }

  protected clearNotice(year: number): void {
    this.run(`notice-${year}`, () =>
      this.api.setNotice(year, { sentAt: null }),
    );
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  protected signed(value: number | null): string {
    if (value === null) return '–';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${euro(Math.abs(value))}`;
  }

  private run(
    key: string,
    call: () => Observable<unknown>,
    after?: () => void,
  ): void {
    this.busy.set(key);
    this.error.set(null);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        after?.();
        this.changed.emit();
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.busy.set(null);
        const message = error.error?.message;
        this.error.set(
          (Array.isArray(message) ? message.join(', ') : message) ??
            'That did not work. Try again in a moment.',
        );
      },
    });
  }
}
