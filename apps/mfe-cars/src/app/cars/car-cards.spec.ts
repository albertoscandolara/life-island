import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import type {
  CarArchiveItemDto,
  CarCostTotalDto,
  RenewalDto,
} from '@life-island/contracts';
import { CarCngCard } from './car-cng-card';
import { CarDocumentsCard } from './car-documents-card';
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

  it('shows what goes in the car, what stays at home and the downloads', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    const item = (o: Partial<CarArchiveItemDto>): CarArchiveItemDto => ({
      uploadId: 'u1',
      title: 'Polizza',
      folder: 'insurance',
      action: 'in_car',
      rule: 'insurance_current',
      date: '2026-03-01',
      validUntil: '2027-03-01',
      keepUntil: null,
      files: [{ uploadId: 'u1', title: 'Polizza' }],
      printFiles: [{ uploadId: 'c1', title: 'Certificato RCA' }],
      ...o,
    });
    const fixture = TestBed.createComponent(CarDocumentsCard);
    fixture.componentRef.setInput('vehicleId', 'v1');
    fixture.componentRef.setInput('status', 'laid_up');
    fixture.componentRef.setInput('archive', {
      items: [
        item({}),
        item({
          uploadId: 'b1',
          title: 'Bollo 2026',
          folder: 'road_tax',
          action: 'keep',
          rule: 'road_tax_claimable',
          keepUntil: '2029-12-31',
          printFiles: [],
        }),
        item({
          uploadId: 'f1',
          title: 'Pieno',
          folder: 'other',
          action: 'discard',
          rule: 'running_cost',
          printFiles: [],
        }),
      ],
      inCar: 1,
      keep: 1,
      discard: 1,
    });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Do not use this car.');
    expect(text).toContain('Certificato RCA');
    expect(text).toContain('At home (1)');
    expect(text).toContain('Can go: 1 no longer needed');
    expect(
      [...element.querySelectorAll('a[download]')].map((a) =>
        a.getAttribute('href'),
      ),
    ).toEqual([
      '/api/cars/vehicles/v1/exports/in-car.zip',
      '/api/cars/vehicles/v1/exports/documents.xlsx',
      '/api/cars/vehicles/v1/exports/archive.zip',
    ]);
  });

  it('shows the CNG cylinders: when, which, every label, and how to load the next one', async () => {
    const fixture = TestBed.createComponent(CarCngCard);
    fixture.componentRef.setInput('status', 'active');
    fixture.componentRef.setInput('vehicleName', 'Punto · AB123CD');
    fixture.componentRef.setInput('cng', {
      approval: 'r110',
      cylinderType: null,
      totalLitres: 84.1,
      cylinders: [
        {
          litres: 66,
          make: 'FABER',
          serialNumber: '12/3456/055',
          dueMonth: '2027-07',
        },
        {
          litres: 18.1,
          make: 'FABER',
          serialNumber: '16/7890/066',
          dueMonth: '2027-07',
        },
      ],
      dueDate: '2027-07-31',
      level: 'expiring',
      daysLeft: 40,
      basis: 'The month printed on the cylinder label',
      endOfLife: null,
      history: [
        {
          uploadId: 'c23',
          month: '2023-07',
          workshop: 'Officina',
          labelNumber: '1',
          cylinders: [],
          replaced: true,
        },
        {
          uploadId: 'c19',
          month: '2019-07',
          workshop: 'Officina',
          labelNumber: '2',
          cylinders: [],
          replaced: false,
        },
      ],
    });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Requalify by');
    expect(text).toContain('Due soon');
    expect(text).toContain('Book a workshop');
    expect(text).toContain('12/3456/055');
    expect(text).toContain('07/2027');
    expect(text).toContain('Cylinders exchanged');
    expect(text).toContain('Not in the car');
    const upload = element.querySelector('a[uiButton]')?.getAttribute('href');
    expect(upload).toContain('upload?area=cars');
    expect(upload).toContain('proof=the+new+CNG+cylinder+label');
  });
});
