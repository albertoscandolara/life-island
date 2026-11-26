import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { proofUploadUrl, type TaxCertificateDto } from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import { WorkApi } from '../api/work-api';
import { dateText, euro, periodText } from './labels';
import {
  certificateMatches,
  type PayslipSlip,
  type PayslipYear,
} from './payslip-months';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const EXTRA_NAMES: Record<string, string> = {
  thirteenth: 'Tredicesima',
  fourteenth: 'Quattordicesima',
  other: 'Extra payslip',
};

/**
 * Your payslips, a year at a time: one slip per month with its net, whether
 * the bank received it and what to check, the original file to open or
 * download, the months missing with the button to load them, and the
 * year's Certificazione Unica against them.
 */
@Component({
  selector: 'work-payslip-archive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiEmptyState, UiIcon],
  templateUrl: './payslip-archive.html',
  styleUrls: ['./payslip-archive.css'],
})
export class PayslipArchive {
  readonly years = input.required<PayslipYear[]>();
  /** The year shown; null shows the latest. */
  readonly year = model<number | null>(null);

  private readonly api = inject(WorkApi);
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly periodText = periodText;
  protected readonly monthNames = MONTH_NAMES;
  protected readonly extraNames = EXTRA_NAMES;
  protected readonly matches = certificateMatches;

  protected readonly shown = computed<PayslipYear | null>(
    () =>
      this.years().find((y) => y.year === this.year()) ??
      this.years()[0] ??
      null,
  );

  /** More than one workplace in the year: each slip names its own. */
  protected readonly manyJobs = computed(() => {
    const ids = new Set(
      this.shown()?.months.flatMap((m) =>
        [...m.slips, ...m.extras].map((s) => s.workplaceId),
      ) ?? [],
    );
    return ids.size > 1;
  });

  /** The latest payslip on the grid: its slip leads. */
  protected readonly latestPeriod = computed(
    () =>
      this.years()
        .flatMap((y) => y.months)
        .filter((m) => m.slips.length)
        .map((m) => m.period)
        .sort()
        .at(-1) ?? null,
  );

  protected previewUrl(slip: PayslipSlip | TaxCertificateDto): string {
    return this.api.previewUrl(
      'doc' in slip ? slip.doc.uploadId : slip.uploadId,
    );
  }

  protected downloadUrl(slip: PayslipSlip | TaxCertificateDto): string {
    return this.api.downloadUrl(
      'doc' in slip ? slip.doc.uploadId : slip.uploadId,
    );
  }

  protected yearUrl(year: number): string {
    return this.api.payslipYearUrl(year);
  }

  /** The documents app, set to load the payslip of a month. */
  protected uploadUrl(period: string): string {
    return proofUploadUrl(this.documentsUrl, {
      module: 'work',
      title: `Payslip ${periodText(period)}`,
    });
  }

  protected cuUploadUrl(year: number): string {
    return proofUploadUrl(this.documentsUrl, {
      module: 'work',
      title: `Certificazione Unica ${year}`,
    });
  }

  /** "Matches", or the gap signed, as the CU sees it. */
  protected gap(value: number | null): string {
    if (value === null) return '–';
    if (Math.abs(value) < 1) return 'Matches';
    return `${value > 0 ? '+' : '−'}${euro(Math.abs(value))}`;
  }

  /** When the CU of a year comes: by 16 March of the next. */
  protected cuDue(year: number): string {
    return `16 Mar ${year + 1}`;
  }

  protected readonly currentYear = new Date().getFullYear();
}
