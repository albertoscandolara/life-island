import { describe, expect, it } from 'vitest';
import type { PayslipYear, WorkOverviewDto } from '@life-island/contracts';
import { workSteps } from './next-steps';

const overview = (over: Partial<WorkOverviewDto> = {}): WorkOverviewDto =>
  ({
    reviews: [],
    certificates: [],
    platforms: [],
    jobSearch: { stale: 0 },
    stats: { monthsSinceLastRise: 6, vacationLeft: 0, leaveLeft: 0 },
    pension: { pending: [], years: [], thisYear: null },
    ...over,
  }) as unknown as WorkOverviewDto;

const year = (over: Partial<PayslipYear>): PayslipYear => ({
  year: 2026,
  months: [],
  count: 0,
  gross: 0,
  net: 0,
  missing: 0,
  toCheck: 0,
  certificates: [],
  ...over,
});

describe('workSteps', () => {
  it('is empty when nothing needs you', () => {
    expect(workSteps(overview(), [], '2026-06-20')).toEqual([]);
  });

  it('puts what is late and due before what to check and the ideas', () => {
    const steps = workSteps(
      overview({
        reviews: [{}, {}] as WorkOverviewDto['reviews'],
        stats: {
          monthsSinceLastRise: 30,
          vacationLeft: 60,
          leaveLeft: 10,
        } as WorkOverviewDto['stats'],
        pension: {
          pending: [],
          thisYear: null,
          years: [
            {
              year: 2024,
              noticeDue: '2025-12-31',
              noticeSentAt: null,
              running: false,
              over: 300,
            },
          ],
        } as unknown as WorkOverviewDto['pension'],
        certificates: [
          {
            uploadId: 'cu',
            year: 2025,
            workplaceName: 'Acme',
            incomeGap: 250,
            taxGap: 0,
            missingMonths: ['2025-04'],
          },
        ] as unknown as WorkOverviewDto['certificates'],
      }),
      [
        year({
          toCheck: 1,
          months: [
            {
              period: '2026-10',
              month: 10,
              state: 'missing',
              slips: [],
              extras: [],
            },
          ],
        }),
      ],
      '2026-11-26',
    );
    expect(steps.map((s) => [s.id, s.level])).toEqual([
      ['notice-2024', 'late'],
      ['review', 'due'],
      ['missing', 'due'],
      ['checks', 'check'],
      ['cu-cu', 'check'],
      ['rise', 'idea'],
      ['time-off', 'idea'],
    ]);
    expect(steps[1].target).toEqual({ kind: 'review' });
    expect(steps[2]).toMatchObject({
      title: 'Load the payslip of Oct 2026',
      target: { kind: 'section', id: 'work-payslips', year: 2026 },
    });
    expect(steps[4].detail).toBe('No payslip for Apr 2025.');
  });
});
