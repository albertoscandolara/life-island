import { reclassificationState } from '../testing/reclassification';
import { reclassifyStartState } from './start-state';

const format = (iso: string) => iso.slice(0, 10);

describe('reclassifyStartState', () => {
  it('can start when nothing blocks it, and says when the monthly check runs', () => {
    const state = reclassifyStartState(
      reclassificationState({ nextScheduledRunAt: '2026-12-01T03:00:00Z' }),
      format,
    );
    expect(state.enabled).toBe(true);
    expect(state.hint).toContain('The next monthly check is on 2026-12-01.');
  });

  it('says why it cannot start', () => {
    const state = reclassifyStartState(
      reclassificationState({
        canStart: false,
        blockedReasons: [
          {
            code: 'PENDING_SUGGESTIONS',
            message:
              '2 suggested categories wait for a decision on the Categories page',
          },
          {
            code: 'PARSING_RUNNING',
            message: 'New documents are being parsed right now',
          },
        ],
      }),
      format,
    );
    expect(state).toEqual({
      enabled: false,
      hint: 'Not now: 2 suggested categories wait for a decision on the Categories page; New documents are being parsed right now.',
    });
  });

  it('is off while a run holds the lock or before the state loads', () => {
    expect(
      reclassifyStartState(reclassificationState({ locked: true })).enabled,
    ).toBe(false);
    expect(reclassifyStartState(null).enabled).toBe(false);
  });
});
