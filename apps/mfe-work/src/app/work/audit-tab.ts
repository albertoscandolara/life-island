import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  documentReviewUrl,
  type AuditSeverity,
  type CcnlComparisonDto,
  type NetChangeDto,
  type PayslipAuditDto,
} from '@life-island/contracts';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import {
  UiBadge,
  UiCard,
  UiEmptyState,
  type UiTone,
} from '@life-island/design-system';
import { WorkApi } from '../api/work-api';
import { euro, periodText, signedEuro } from './labels';

const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  problem: 'Problem',
  check: 'To check',
  info: 'Good to know',
};
const SEVERITY_TONES: Record<AuditSeverity, UiTone> = {
  problem: 'danger',
  check: 'warning',
  info: 'info',
};

/**
 * Payslip audit: your payslips against the rules of your CCNL (minimum,
 * seniority increments, superminimum, vacation, tredicesima, TFR,
 * contributions), and why the net changed from one month to the next.
 */
@Component({
  selector: 'work-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard, UiEmptyState],
  templateUrl: './audit-tab.html',
  styleUrls: ['./blocks.css', './audit-tab.css'],
})
export class AuditTab {
  private readonly api = inject(WorkApi);
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  readonly audit = input.required<PayslipAuditDto>();
  readonly netChanges = input<NetChangeDto[]>([]);
  /** Your level's CCNL minimums, agreed from now on. */
  readonly ccnl = input.required<CcnlComparisonDto>();

  protected readonly euro = euro;
  protected readonly periodText = periodText;
  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly severityTones = SEVERITY_TONES;

  /** Every month, or only the latest six whose net moved. */
  protected readonly showAll = signal(false);
  protected readonly shownChanges = computed(() =>
    this.showAll()
      ? this.netChanges()
      : this.netChanges()
          .filter((c) => c.parts.length)
          .slice(0, 6),
  );

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  /** The payslip in the documents app, to fix what was read or parse it again. */
  protected reviewUrl(uploadId: string): string {
    return documentReviewUrl(this.documentsUrl, uploadId);
  }

  protected readonly signedEuro = signedEuro;

  /** A part's bar, as a share of the change's largest part. */
  protected width(change: NetChangeDto, amount: number): number {
    const max = Math.max(...change.parts.map((p) => Math.abs(p.amount)), 1);
    return Math.max(2, (Math.abs(amount) / max) * 100);
  }
}
