import { TestBed } from '@angular/core/testing';
import type { TaxYearDto } from '@life-island/contracts';
import { YearComparison } from './year-comparison';

const year = (taxYear: number, byType: TaxYearDto['byType']): TaxYearDto => ({
  taxYear,
  filingYear: taxYear + 1,
  total: byType.reduce((sum, t) => sum + t.total, 0),
  expenseCount: byType.reduce((sum, t) => sum + t.count, 0),
  byType,
  untraceableCount: 0,
  missingInvoiceCount: 0,
  missingPaymentCount: 0,
  deductions: { lines: [], carried: [], thisYear: 0, futureYears: 0 },
  byMonth: Array(12).fill(0),
});

describe('YearComparison', () => {
  it('puts years oldest first and each type in one row across years', async () => {
    const fixture = TestBed.createComponent(YearComparison);
    fixture.componentRef.setInput('years', [
      year(2026, [{ expenseType: 'renovation', total: 27736, count: 7 }]),
      year(2025, [
        { expenseType: 'renovation', total: 85992.5, count: 9 },
        { expenseType: 'medical', total: 180, count: 1 },
      ]),
    ]);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const headers = [...element.querySelectorAll('thead th')].map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(['Type', '2025', '2026']);
    const rows = [...element.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.children].map((cell) =>
        cell.textContent?.trim().replace(/\s/g, ' '),
      ),
    );
    expect(rows).toEqual([
      ['Home renovation', '85.992,50 €', '27.736,00 €'],
      ['Medical', '180,00 €', '–'],
    ]);
  });
});
