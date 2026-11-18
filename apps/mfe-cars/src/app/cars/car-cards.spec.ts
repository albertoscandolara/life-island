import { TestBed } from '@angular/core/testing';
import type { CarCostTotalDto, RenewalDto } from '@life-island/contracts';
import { CarCostsCard } from './car-costs-card';
import { CarRenewalsCard } from './car-renewals-card';

describe('Cars cards', () => {
  it('totals the costs year by year, kind by kind', async () => {
    const totals: CarCostTotalDto[] = [
      { year: 2026, kind: 'insurance', total: 480 },
      { year: 2026, kind: 'fuel', total: 1200.5 },
      { year: 2025, kind: 'insurance', total: 450 },
    ];
    const fixture = TestBed.createComponent(CarCostsCard);
    fixture.componentRef.setInput('totals', totals);
    fixture.componentRef.setInput('costs', [
      {
        uploadId: 'u1',
        title: 'Polizza',
        type: null,
        kind: 'insurance',
        date: '2026-03-01',
        amount: 480,
        supplier: null,
        odometerKm: null,
        litres: null,
        bankPayment: {
          paid: 480,
          full: true,
          lastDate: '2026-03-02',
          accounts: ['Conto'],
        },
      },
    ]);
    await fixture.whenStable();
    // What the bank paid, matched in Money.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('ui-badge')
        ?.textContent,
    ).toContain('Paid');
    const rows = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('2026');
    expect(rows[0]).toContain('1.680,50');
    expect(rows[1]).toContain('2025');
    // A kind with nothing that year shows a dash, never 0.
    expect(rows[1]).toContain('–');
  });

  it('lists each renewal with its state', async () => {
    const renewal: RenewalDto = {
      kind: 'insurance',
      subject: null,
      level: 'expiring',
      dueDate: '2026-12-01',
      daysLeft: 14,
      graceUntil: null,
      uploadId: 'u1',
      basis: 'From the policy',
      dueOdometerKm: null,
    };
    const fixture = TestBed.createComponent(CarRenewalsCard);
    fixture.componentRef.setInput('renewals', [renewal]);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Expiring');
    expect(text).toContain('From the policy');
  });
});
