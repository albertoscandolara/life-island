import {
  aCheckIn,
  aDream,
  aMilestone,
  anOverview,
  aStep,
} from '../testing/fixtures';
import { dreamsTiles, fearPairs, monthOf, proof, upNext } from './overview';

describe('Dreams overview', () => {
  it('moves months across the year', () => {
    expect(monthOf('2026-01-14', -1)).toBe('2025-12');
    expect(monthOf('2026-11-14')).toBe('2026-11');
  });

  it('puts a check-in first, then the planned step, with its milestone', () => {
    const data = anOverview({
      dreams: [
        aDream({
          id: 'd1',
          milestones: [
            aMilestone({ reachedOn: '2026-11-05', current: false }),
            aMilestone({ id: 'm2', title: 'I know what is out there' }),
          ],
          steps: [aStep({ milestoneId: 'm2', dueDate: '2026-11-16' })],
        }),
        aDream({
          id: 'd2',
          title: 'Run 10 km',
          area: 'fitness',
          steps: [
            aStep({
              id: 's9',
              dreamId: 'd2',
              status: 'done',
              awaitingCheckIn: true,
            }),
          ],
        }),
      ],
    });
    const items = upNext(data);
    expect(items.map((i) => i.kind)).toEqual(['check-in', 'step']);
    expect(items[1]?.context).toBe(
      'Change company · milestone 2 of 2: I know what is out there',
    );
    expect(items[1]?.purpose).toBe('Clear words make the next step obvious.');
  });

  it('asks for questions first, then for steps, on a dream with no step', () => {
    const fresh = aDream({ steps: [], milestones: [] });
    expect(upNext(anOverview({ dreams: [fresh] }))[0]?.kind).toBe('questions');
    const answered = aDream({
      steps: [],
      questions: [
        {
          id: 'q',
          dreamId: 'd1',
          question: 'What is wrong?',
          why: null,
          answer: 'Growth',
          source: 'offline',
          createdAt: '',
        },
      ],
    });
    expect(upNext(anOverview({ dreams: [answered] }))[0]?.kind).toBe('steps');
    // Resting and reached dreams wait.
    expect(
      upNext(anOverview({ dreams: [aDream({ status: 'paused' })] })),
    ).toEqual([]);
  });

  it('counts the tiles: next step, steps this month, fear, habits', () => {
    const data = anOverview({
      dreams: [
        aDream({
          steps: [
            aStep({ id: 'a', dueDate: '2026-11-20' }),
            aStep({ id: 'b', status: 'done', doneOn: '2026-11-03' }),
            aStep({ id: 'c', status: 'done', doneOn: '2026-10-20' }),
          ],
          checkIns: [
            aCheckIn({ id: 'x', stepId: 'b', expectedHard: 4, actualHard: 2 }),
            aCheckIn({ id: 'y', stepId: 'c', expectedHard: 3, actualHard: 3 }),
          ],
        }),
        aDream({ id: 'd2', steps: [], status: 'dreaming' }),
      ],
      habits: [
        {
          id: 'h',
          title: 'Walk',
          dreamId: null,
          perWeek: 2,
          active: true,
          createdAt: '',
          checked: [],
          thisWeek: 2,
          streak: 1,
        },
      ],
    });
    const t = dreamsTiles(data);
    expect(t.next?.step.id).toBe('a');
    expect(t.waiting).toBe(1);
    expect(t.steps).toEqual({ thisMonth: 1, lastMonth: 1, total: 2 });
    expect(t.fear).toEqual({ compared: 2, easier: 1, same: 1 });
    expect(t.habits).toEqual({ onTarget: 1, active: 1 });
  });

  it('keeps forecasts with a real hardness, and what each step showed you', () => {
    const data = anOverview({
      dreams: [
        aDream({
          checkIns: [
            aCheckIn({ id: 'a', expectedHard: 5, actualHard: 2 }),
            aCheckIn({ id: 'b', expectedHard: 3, actualHard: null }),
            aCheckIn({
              id: 'c',
              learned: 'I can ask',
              createdAt: '2026-11-12T00:00:00.000Z',
            }),
            aCheckIn({ id: 'd', learned: 'I can wait' }),
          ],
        }),
      ],
    });
    expect(fearPairs(data).map((p) => [p.expected, p.actual])).toEqual([
      [5, 2],
    ]);
    expect(proof(data).map((p) => p.learned)).toEqual([
      'I can ask',
      'I can wait',
    ]);
  });
});
