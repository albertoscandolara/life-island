import type { ParseQueueDto } from '@life-island/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import {
  lastRunText,
  parseNowError,
  parseNowState,
  queueMessage,
} from './queue-banner';

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
  runRequestedAt: null,
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

describe('parseNowState', () => {
  it('is on when documents wait and the queue is idle or blocked', () => {
    expect(parseNowState({ ...base, pendingDocuments: 2 }, format)).toEqual({
      enabled: true,
      hint: 'Start reading the 2 waiting documents now instead of at the next scheduled run.',
    });
    expect(
      parseNowState(
        { ...base, status: 'BLOCKED_CREDENTIALS', pendingDocuments: 1 },
        format,
      ).enabled,
    ).toBe(true);
  });

  it('says why it is off', () => {
    expect(parseNowState({ ...base, pendingDocuments: 0 }, format)).toEqual({
      enabled: false,
      hint: 'No document is waiting to be read.',
    });
    expect(parseNowState({ ...base, status: 'RUNNING' }, format).hint).toBe(
      'The AI is already reading documents.',
    );
    expect(
      parseNowState(
        {
          ...base,
          status: 'PAUSED_QUOTA',
          resumeAt: '2026-10-30T04:00:00.000Z',
        },
        format,
      ),
    ).toEqual({
      enabled: false,
      hint: 'Paused by the AI provider until 2026-10-30T04:00.',
    });
  });
});

describe('parseNowError', () => {
  it('explains a 404 as a service that predates Parse now', () => {
    const error = new HttpErrorResponse({
      status: 404,
      error: { message: 'Cannot POST /parse-queue/run' },
    });
    expect(parseNowError(error)).toContain('Restart svc-ingestion');
  });

  it('passes other errors through', () => {
    const error = new HttpErrorResponse({
      status: 500,
      error: { message: 'Database is down' },
    });
    expect(parseNowError(error)).toBe('Database is down');
  });
});
