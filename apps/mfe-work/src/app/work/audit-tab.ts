import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type {
  AuditSeverity,
  NetChangeDto,
  PayslipAuditDto,
} from '@life-island/contracts';
import {
  UiBadge,
  UiCard,
  UiEmptyState,
  type UiTone,
} from '@life-island/design-system';
import { WorkApi } from '../api/work-api';
import { euro, periodText } from './labels';

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

  readonly audit = input.required<PayslipAuditDto>();
  readonly netChanges = input<NetChangeDto[]>([]);

  protected readonly euro = euro;
  protected readonly periodText = periodText;
  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly severityTones = SEVERITY_TONES;

  protected readonly counts = computed(() => {
    const findings = this.audit().findings;
    return (['problem', 'check', 'info'] as const).map((severity) => ({
      severity,
      count: findings.filter((f) => f.severity === severity).length,
    }));
  });

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  protected signedEuro(value: number): string {
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${euro(Math.abs(value))}`;
  }

  /** A part's bar, as a share of the change's largest part. */
  protected width(change: NetChangeDto, amount: number): number {
    const max = Math.max(...change.parts.map((p) => Math.abs(p.amount)), 1);
    return Math.max(2, (Math.abs(amount) / max) * 100);
  }
}
