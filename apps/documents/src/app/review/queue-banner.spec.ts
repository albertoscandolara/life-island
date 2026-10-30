import type { ParseQueueDto } from '@life-island/contracts';
import { lastRunText, queueMessage } from './queue-banner';

const base: ParseQueueDto = {
  status: 'IDLE',
  pauseReason: null,
  providerError: null,
  pausedAt: null,
  resumeAt: null,
  resumeAtReliable: false,
  runStartedAt: null,
  runFinishedAt: null,
  nextScheduledRunAt: '2026-10-30T05:00:00.000Z',
  lastRunSummary: null,
  pendingDocuments: 3,
};
const format = (iso: string) => iso.slice(0, 16);

describe('queueMessage', () => {
  it('explains a quota pause and says the resume time is unknown when it is', () => {
    const message = queueMessage(
      {
        ...base,
        status: 'PAUSED_QUOTA',
        resumeAt: '2026-10-30T04:00:00.000Z',
        providerError: { message: 'Your credit balance is too low' },
      },
      format,
    )!;
    expect(message.heading).toBe('Status: Paused — AI usage quota exhausted');
    expect(message.lines[0]).toContain('Completed work has been saved');
    expect(message.lines[0]).toContain('resume automatically');
    expect(message.lines[1]).toBe(
      'The resumption time is currently unknown. The service will next check whether quota is available on 2026-10-30T04:00.',
    );
    expect(message.lines).toContain(
      'Provider message: Your credit balance is too low',
    );
  });

  it('states the resume time when the provider gave it', () => {
    const message = queueMessage(
      {
        ...base,
        status: 'PAUSED_QUOTA',
        resumeAt: '2026-11-01T00:01:00.000Z',
        resumeAtReliable: true,
      },
      format,
    )!;
    expect(message.lines[1]).toContain('available again on 2026-11-01T00:01');
  });

  it('says nothing when there is nothing to process', () => {
    expect(queueMessage({ ...base, pendingDocuments: 0 })).toBeNull();
    expect(queueMessage(base, format)?.lines[0]).toContain(
      'next scheduled run is on 2026-10-30T05:00',
    );
  });
});

describe('lastRunText', () => {
  it('says when the service last ran, what it did and when it runs next', () => {
    expect(
      lastRunText(
        {
          ...base,
          runStartedAt: '2026-10-29T05:00:00.000Z',
          runFinishedAt: '2026-10-29T05:03:00.000Z',
          lastRunSummary: { parsed: 4, retried: 0, failed: 1, paused: 0 },
        },
        format,
      ),
    ).toBe(
      'Last run 2026-10-29T05:00, finished 2026-10-29T05:03: 4 processed, 1 failed. Next scheduled run 2026-10-30T05:00.',
    );
  });

  it('says a run is in progress, or that there was none yet', () => {
    expect(
      lastRunText(
        {
          ...base,
          status: 'RUNNING',
          runStartedAt: '2026-10-30T05:00:00.000Z',
        },
        format,
      ),
    ).toMatch(/^Running since 2026-10-30T05:00\./);
    expect(lastRunText({ ...base, nextScheduledRunAt: null }, format)).toBe(
      'The processing service has not run yet.',
    );
  });
});
