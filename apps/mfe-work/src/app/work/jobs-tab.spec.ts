import { describe, expect, it } from 'vitest';
import type { JobApplicationDto } from '@life-island/contracts';
import {
  applicationRequest,
  offerDraftOf,
  withStatus,
  type ApplicationDraft,
} from './jobs-tab';

const application: JobApplicationDto = {
  id: 'a1',
  company: 'Nuova Srl',
  role: 'Process engineer',
  source: 'LinkedIn',
  url: null,
  location: 'Verona',
  status: 'interview',
  appliedAt: '2026-10-01',
  nextStep: null,
  nextStepAt: null,
  ralMin: 35000,
  ralMax: 40000,
  offerRal: 38500,
  offerMonths: 14,
  offerWelfare: 600,
  offerBonus: null,
  notes: null,
  history: [{ status: 'applied', at: '2026-10-01' }],
  idleDays: 3,
  stale: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

describe('applicationRequest', () => {
  it('parses amounts and turns blanks into null', () => {
    const draft: ApplicationDraft = {
      id: null,
      company: ' Nuova Srl ',
      role: 'Engineer',
      source: '',
      url: '',
      location: ' ',
      status: 'applied',
      appliedAt: '2026-11-01',
      nextStep: '',
      nextStepAt: '',
      ralMin: '35k',
      ralMax: '42.000',
      offerRal: '',
      offerMonths: '',
      offerWelfare: '',
      offerBonus: '',
      notes: '',
    };
    expect(applicationRequest(draft)).toMatchObject({
      company: 'Nuova Srl',
      source: null,
      location: null,
      ralMin: 35000,
      ralMax: 42000,
      offerRal: null,
      offerMonths: null,
      nextStepAt: null,
    });
  });
});

describe('withStatus', () => {
  it('keeps every field and changes the status only', () => {
    const request = withStatus(application, 'offer');
    expect(request.status).toBe('offer');
    expect(request.offerRal).toBe(38500);
    expect(request.appliedAt).toBe('2026-10-01');
  });
});

describe('offerDraftOf', () => {
  it('fills the offer comparison', () => {
    expect(offerDraftOf(application)).toEqual({
      employer: 'Nuova Srl',
      ral: '38500',
      monthsPaid: '14',
      welfare: '600',
      bonus: '',
      benefits: '',
      costs: '',
    });
  });
});
