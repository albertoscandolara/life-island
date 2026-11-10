import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  estimateNet,
  NEGOTIATION_QUESTION,
  type CareerFeedbackDto,
  type MarketCheckDto,
  type MarketPosition,
  type NegotiationBriefDto,
  type OfferBaselineDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import { WorkApi } from '../api/work-api';
import { euro, parseAmount, periodText } from './labels';

/** What an offer is worth, as you type it. */
export interface OfferDraft {
  employer: string;
  ral: string;
  monthsPaid: '13' | '14';
  welfare: string;
  bonus: string;
  /** Meal vouchers, car, other benefits, a year. */
  benefits: string;
  /** Commuting or moving costs a year, more (positive) or less than now. */
  costs: string;
}

/** One column of the offer comparison. */
export interface OfferColumn {
  label: string;
  ral: number;
  monthsPaid: number;
  net: number;
  netMonthly: number;
  wedgePct: number;
  welfare: number;
  bonus: number;
  benefits: number;
  costs: number;
  /** Net, welfare, bonus after tax and benefits, less costs. */
  total: number;
}

/** A bonus is taxed like salary: what is left of it at the offer's rates. */
function netBonus(
  ral: number,
  bonus: number,
  rates: { contributionRatePct: number; surtaxRatePct: number },
  year: number,
): number {
  if (!bonus) return 0;
  const without = estimateNet({ ral, year, ...rates }).net;
  const withBonus = estimateNet({ ral: ral + bonus, year, ...rates }).net;
  return Math.round((withBonus - without) * 100) / 100;
}

/** Your current package and an offer, both in yearly net euros. */
export function compareOffer(
  baseline: OfferBaselineDto,
  draft: OfferDraft,
  year: number,
): { current: OfferColumn | null; offer: OfferColumn | null } {
  const rates = {
    contributionRatePct: baseline.contributionRatePct,
    surtaxRatePct: baseline.surtaxRatePct,
  };
  const column = (
    label: string,
    ral: number,
    monthsPaid: number,
    welfare: number,
    bonus: number,
    benefits: number,
    costs: number,
  ): OfferColumn => {
    const estimate = estimateNet({ ral, year, ...rates });
    const bonusNet = netBonus(ral, bonus, rates, year);
    return {
      label,
      ral,
      monthsPaid,
      net: estimate.net,
      netMonthly: Math.round((estimate.net / monthsPaid) * 100) / 100,
      wedgePct: estimate.wedgePct,
      welfare,
      bonus: bonusNet,
      benefits,
      costs,
      total:
        Math.round(
          (estimate.net + welfare + bonusNet + benefits - costs) * 100,
        ) / 100,
    };
  };
  const current =
    baseline.ral !== null
      ? column(
          baseline.employer ?? 'Now',
          baseline.ral,
          baseline.monthsPaid,
          baseline.welfare12,
          baseline.bonus12,
          0,
          0,
        )
      : null;
  const ral = parseAmount(draft.ral);
  const offer =
    ral !== null && ral > 0
      ? column(
          draft.employer.trim() || 'The offer',
          ral,
          Number(draft.monthsPaid),
          parseAmount(draft.welfare) ?? 0,
          parseAmount(draft.bonus) ?? 0,
          parseAmount(draft.benefits) ?? 0,
          parseAmount(draft.costs) ?? 0,
        )
      : null;
  return { current, offer };
}

const POSITION_LABELS: Record<MarketPosition, string> = {
  below: 'Below the market',
  within: 'Within the market',
  above: 'Above the market',
  unknown: 'Position unclear',
};
const POSITION_TONES: Record<MarketPosition, UiTone> = {
  below: 'warning',
  within: 'success',
  above: 'success',
  unknown: 'neutral',
};

/**
 * Tools: compare a job offer with what you have, check your pay against
 * public salary ranges, and prepare the next salary negotiation.
 */
@Component({
  selector: 'work-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiTool, UiAiPanel, UiAiStatus, UiBadge, UiButton, UiCard, UiIcon],
  templateUrl: './tools-tab.html',
  styleUrls: ['./blocks.css', './tools-tab.css'],
})
export class ToolsTab {
  private readonly api = inject(WorkApi);

  readonly baseline = input.required<OfferBaselineDto>();
  readonly marketChecks = input<MarketCheckDto[]>([]);
  readonly brief = input.required<NegotiationBriefDto>();
  readonly feedback = input<CareerFeedbackDto[]>([]);
  readonly aiFeedback = input(false);
  readonly aiMarketCheck = input(false);
  /** An offer to compare, from the job search. */
  readonly offerPrefill = input<OfferDraft | null>(null);
  /** Something was saved: the page reloads the overview. */
  readonly changed = output<void>();

  protected readonly euro = euro;
  protected readonly periodText = periodText;
  protected readonly positionLabels = POSITION_LABELS;
  protected readonly positionTones = POSITION_TONES;
  /** The rows of the comparison, for difference(). */
  protected readonly pick = {
    ral: (c: OfferColumn) => c.ral,
    net: (c: OfferColumn) => c.net,
    netMonthly: (c: OfferColumn) => c.netMonthly,
    welfare: (c: OfferColumn) => c.welfare,
    bonus: (c: OfferColumn) => c.bonus,
    total: (c: OfferColumn) => c.total,
  };

  protected readonly draft = signal<OfferDraft>({
    employer: '',
    ral: '',
    monthsPaid: '13',
    welfare: '',
    bonus: '',
    benefits: '',
    costs: '',
  });
  protected readonly year = new Date().getFullYear();

  constructor() {
    effect(() => {
      const prefill = this.offerPrefill();
      if (prefill) this.draft.set({ ...prefill });
    });
  }

  protected readonly comparison = computed(() =>
    compareOffer(this.baseline(), this.draft(), this.year),
  );
  /** The offer's RAL that would leave you as well off as now. */
  protected readonly breakEven = computed(() => {
    const { current } = this.comparison();
    const d = this.draft();
    if (!current) return null;
    const extras =
      (parseAmount(d.welfare) ?? 0) +
      (parseAmount(d.benefits) ?? 0) -
      (parseAmount(d.costs) ?? 0);
    const rates = {
      contributionRatePct: this.baseline().contributionRatePct,
      surtaxRatePct: this.baseline().surtaxRatePct,
    };
    // Bisection on the RAL: net grows with the RAL.
    let low = 0;
    let high = current.ral * 3 + 50000;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      const net = estimateNet({ ral: mid, year: this.year, ...rates }).net;
      if (net + extras < current.total) low = mid;
      else high = mid;
    }
    return Math.ceil(high / 100) * 100;
  });

  protected readonly role = signal('');
  protected readonly region = signal('');
  protected readonly checking = signal(false);
  protected readonly shownCheckId = signal<string | null>(null);
  protected readonly shownCheck = computed(
    () =>
      this.marketChecks().find((m) => m.id === this.shownCheckId()) ??
      this.marketChecks()[0] ??
      null,
  );

  protected readonly writing = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly talkingPoints = computed(
    () =>
      this.feedback().find((f) => f.question === NEGOTIATION_QUESTION) ?? null,
  );

  protected setDraft(change: Partial<OfferDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  protected difference(pick: (c: OfferColumn) => number): number | null {
    const { current, offer } = this.comparison();
    return current && offer ? pick(offer) - pick(current) : null;
  }

  protected signedEuro(value: number | null): string {
    if (value === null) return '–';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${euro(Math.abs(value))}`;
  }

  /** Where the RAL falls on a range, from 0 (low) to 100 (high), for the marker. */
  protected markerAt(
    low: number | null,
    high: number | null,
    ral: number | null,
  ): number | null {
    if (low === null || high === null || ral === null || high <= low)
      return null;
    return Math.max(0, Math.min(100, ((ral - low) / (high - low)) * 100));
  }

  protected checkMarket(): void {
    this.checking.set(true);
    this.error.set(null);
    this.api
      .runMarketCheck({
        role: this.role().trim() || null,
        region: this.region().trim() || null,
      })
      .subscribe({
        next: (check) => {
          this.checking.set(false);
          this.shownCheckId.set(check.id);
          this.changed.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.checking.set(false);
          this.error.set(
            error.error?.message ??
              'The market check could not run. Try again in a moment.',
          );
        },
      });
  }

  protected removeCheck(check: MarketCheckDto): void {
    this.api.removeMarketCheck(check.id).subscribe({
      next: () => {
        this.shownCheckId.set(null);
        this.changed.emit();
      },
      error: () => this.error.set('The check could not be deleted.'),
    });
  }

  protected writeTalkingPoints(): void {
    this.writing.set(true);
    this.error.set(null);
    this.api.askFeedback(NEGOTIATION_QUESTION).subscribe({
      next: () => {
        this.writing.set(false);
        this.changed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.writing.set(false);
        this.error.set(
          error.error?.message ??
            'The talking points could not be written. Try again in a moment.',
        );
      },
    });
  }

  /** The brief as plain text, to paste in a note or an email to yourself. */
  protected briefText(): string {
    const b = this.brief();
    const lines = [
      `Salary review${b.employer ? ` at ${b.employer}` : ''}${b.role ? `, ${b.role}` : ''}${b.level ? `, level ${b.level}` : ''}`,
      '',
      'Facts',
      ...b.facts.map(
        (f) => `- ${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ''}`,
      ),
      '',
      'Arguments',
      ...b.arguments.map((a) => `- ${a}`),
      '',
      'What to ask',
      ...b.asks.map((a) => `- ${a}`),
    ];
    const points = this.talkingPoints();
    if (points) {
      lines.push(
        '',
        'Talking points',
        ...points.strengths.map((s) => `- ${s}`),
      );
      if (points.watchouts.length)
        lines.push(
          '',
          'What they may say',
          ...points.watchouts.map((w) => `- ${w}`),
        );
    }
    return lines.join('\n');
  }

  protected copyBrief(): void {
    void navigator.clipboard?.writeText(this.briefText()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  protected printBrief(): void {
    window.print();
  }
}
