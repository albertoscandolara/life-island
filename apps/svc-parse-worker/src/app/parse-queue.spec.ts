import { planResume } from './parse-queue.js';

const config = {
  quotaRetryMinutes: 360,
  quotaRetryMaxMinutes: 1440,
  rateLimitRetrySeconds: 60,
};
const now = new Date('2026-10-29T10:00:00Z');

describe('planResume', () => {
  it('trusts a reset time from the provider', () => {
    expect(
      planResume(
        {
          kind: 'PAUSED_QUOTA',
          providerResumeAt: new Date('2026-11-01T00:00:00Z'),
        },
        3,
        config,
        now,
      ),
    ).toEqual({ resumeAt: new Date('2026-11-01T00:01:00Z'), reliable: true });
  });

  it('without one, checks the quota rarely and less often each time it is still gone', () => {
    const waits = [0, 1, 2, 3].map(
      (attempts) =>
        (planResume(
          { kind: 'PAUSED_QUOTA', providerResumeAt: null },
          attempts,
          config,
          now,
        ).resumeAt.getTime() -
          now.getTime()) /
        60_000,
    );
    expect(waits).toEqual([360, 720, 1440, 1440]);
    expect(
      planResume(
        { kind: 'PAUSED_QUOTA', providerResumeAt: null },
        0,
        config,
        now,
      ).reliable,
    ).toBe(false);
  });

  it('waits a short fixed time after a rate limit without retry-after', () => {
    expect(
      planResume(
        { kind: 'PAUSED_RATE_LIMIT', providerResumeAt: null },
        5,
        config,
        now,
      ),
    ).toEqual({ resumeAt: new Date('2026-10-29T10:01:00Z'), reliable: false });
  });
});
