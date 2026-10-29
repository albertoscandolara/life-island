import type { ParseQueueDto } from '@life-island/contracts';
import { queueMessage } from './queue-banner';

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
