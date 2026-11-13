import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type {
  DossierExpenseDto,
  Tax730AttachmentDto,
  Tax730AttachmentRole,
  TaxYearDossierDto,
  TaxYearDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { Tax730Api } from '../api/tax730-api';
import { DocumentPicker, type PickedDocument } from '../picker/document-picker';
import { Tax730Guide } from '../guide/tax730-guide';
import { DeductionsCard } from './deductions-card';
import { MonthChart } from './month-chart';
import { YearComparison } from './year-comparison';
import { formatDate, formatEuro, ROLE_LABELS, typeLabel } from './format';

type PickerTarget =
  | {
      kind: 'expense';
      expense: DossierExpenseDto;
      roles: Tax730AttachmentRole[];
    }
  | { kind: 'year'; roles: Tax730AttachmentRole[] };

/**
 * Ankylo's 730: every document that goes into a year's tax return, grouped by
 * year, with what is still missing and the exports for the commercialista.
 */
@Component({
  selector: 'tax-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiPageHeader,
    UiCard,
    UiButton,
    UiBadge,
    UiIcon,
    UiAlert,
    UiEmptyState,
    DocumentPicker,
    YearComparison,
    DeductionsCard,
    MonthChart,
    Tax730Guide,
    EntityLink,
  ],
  host: { 'data-character': 'ankylo', class: 'tax730' },
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage {
  private readonly api = inject(Tax730Api);
  private readonly router = inject(Router);

  /** `?year=2025` from the URL. */
  readonly year = input<string>();

  protected readonly years = signal<TaxYearDto[] | null>(null);
  protected readonly dossier = signal<TaxYearDossierDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly picker = signal<PickerTarget | null>(null);
  protected readonly pickerOpen = signal(false);

  protected readonly selectedYear = computed(() => {
    const years = this.years();
    if (!years?.length) return null;
    const asked = Number(this.year());
    return years.some((y) => y.taxYear === asked) ? asked : years[0].taxYear;
  });

  /** The year the explainer's rates are for: the one shown, or last year. */
  protected readonly guideYear = computed(
    () => this.selectedYear() ?? new Date().getFullYear() - 1,
  );

  protected readonly formatEuro = formatEuro;
  protected readonly formatDate = formatDate;
  protected readonly typeLabel = typeLabel;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly previewUrl = (id: string) => this.api.previewUrl(id);
  protected readonly zipUrl = (year: number) => this.api.zipUrl(year);
  protected readonly workbookUrl = (years: number[] = []) =>
    this.api.workbookUrl(years);

  constructor() {
    this.loadYears();
    effect(() => {
      const year = this.selectedYear();
      if (year !== null) this.loadDossier(year);
    });
  }

  protected selectYear(year: number): void {
    void this.router.navigate([], {
      queryParams: { year },
      queryParamsHandling: 'merge',
    });
  }

  protected toggle(expense: DossierExpenseDto): void {
    this.expanded.update((id) => (id === expense.id ? null : expense.id));
  }

  protected openPicker(target: PickerTarget): void {
    this.picker.set(target);
    this.pickerOpen.set(true);
  }

  protected pickerHeading(target: PickerTarget): string {
    return target.kind === 'expense'
      ? `File a document for ${target.expense.issuer}`
      : `File a document for ${this.selectedYear()}`;
  }

  protected onPicked(target: PickerTarget, picked: PickedDocument): void {
    if (target.kind === 'expense') {
      this.api.addExpenseAttachment(target.expense.id, picked).subscribe({
        next: (expense) => this.replaceExpense(expense),
        error: (error) => this.fail(error),
      });
    } else {
      const year = this.selectedYear();
      if (year === null) return;
      this.api.addYearAttachment(year, picked).subscribe({
        next: (dossier) => this.setDossier(dossier),
        error: (error) => this.fail(error),
      });
    }
  }

  protected removeExpenseAttachment(
    expense: DossierExpenseDto,
    attachment: Tax730AttachmentDto,
  ): void {
    this.api
      .removeExpenseAttachment(expense.id, attachment.uploadId)
      .subscribe({
        next: (updated) => this.replaceExpense(updated),
        error: (error) => this.fail(error),
      });
  }

  protected removeYearAttachment(attachment: Tax730AttachmentDto): void {
    const year = this.selectedYear();
    if (year === null) return;
    this.api.removeYearAttachment(year, attachment.uploadId).subscribe({
      next: (dossier) => this.setDossier(dossier),
      error: (error) => this.fail(error),
    });
  }

  protected save(
    expense: DossierExpenseDto,
    description: string,
    notes: string,
  ): void {
    this.api
      .updateExpense(expense.id, {
        description: description.trim() || null,
        notes: notes.trim() || null,
      })
      .subscribe({
        next: () => {
          this.editing.set(null);
          const year = this.selectedYear();
          if (year !== null) this.loadDossier(year);
        },
        error: (error) => this.fail(error),
      });
  }

  protected attachmentTitle(attachment: Tax730AttachmentDto): string {
    if (!attachment.document) return 'Document not found';
    if (attachment.document.deleted) return 'Deleted from your documents';
    return attachment.document.title;
  }

  private loadYears(): void {
    this.api.taxYears().subscribe({
      next: (years) => this.years.set(years),
      error: (error) => {
        this.years.set([]);
        this.fail(error);
      },
    });
  }

  private loadDossier(year: number): void {
    this.api.dossier(year).subscribe({
      next: (dossier) => this.setDossier(dossier),
      error: (error) => this.fail(error),
    });
  }

  private setDossier(dossier: TaxYearDossierDto): void {
    this.error.set(null);
    this.dossier.set(dossier);
    // Keep the year strip's counts in step with what you just filed.
    this.years.update(
      (years) =>
        years?.map((year) => {
          if (year.taxYear !== dossier.taxYear) return year;
          const {
            expenses: _expenses,
            yearDocuments: _documents,
            ...summary
          } = dossier;
          return summary;
        }) ?? null,
    );
  }

  private replaceExpense(expense: DossierExpenseDto): void {
    const year = this.selectedYear();
    if (year !== null) this.loadDossier(year);
    this.expanded.set(expense.id);
  }

  private fail(error: unknown): void {
    const message =
      (error as { error?: { message?: string }; message?: string })?.error
        ?.message ??
      (error as { message?: string })?.message ??
      'Something went wrong';
    this.error.set(
      (error as { status?: number })?.status === 0 ||
        (error as { status?: number })?.status === 502
        ? 'The 730 service is not reachable. Start it with `npx nx serve svc-tax730`.'
        : message,
    );
  }
}
