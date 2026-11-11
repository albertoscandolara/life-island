import {
  isoAddMonths,
  resultFlag,
  type CheckupDto,
  type ResultsExplainerOutput,
  type TestResultDto,
  type TestSeriesDto,
} from '@life-island/contracts';

/*
 * Health as a pure computation: each result's flag, the series of a test over
 * time, when each checkup is next due, and the explainer's own rules.
 */

export function withFlag(result: Omit<TestResultDto, 'flag'>): TestResultDto {
  return { ...result, flag: resultFlag(result.value, result.low, result.high) };
}

export function series(results: readonly TestResultDto[]): TestSeriesDto[] {
  const groups = new Map<string, TestResultDto[]>();
  for (const r of results) {
    const key = `${r.person.toLowerCase()}|${r.test.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted[sorted.length - 1];
      const before = sorted[sorted.length - 2];
      let trend: TestSeriesDto['trend'] = null;
      if (before) {
        const change =
          (last.value - before.value) / (Math.abs(before.value) || 1);
        trend = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'steady';
      }
      return {
        person: last.person,
        test: last.test,
        unit: last.unit,
        low: last.low,
        high: last.high,
        points: sorted.map((r) => ({
          date: r.date,
          value: r.value,
          flag: r.flag,
        })),
        trend,
      };
    })
    .sort(
      (a, b) =>
        a.person.localeCompare(b.person) || a.test.localeCompare(b.test),
    );
}

export function withDue(
  checkup: Omit<CheckupDto, 'nextDueOn' | 'overdue'>,
  today: string,
): CheckupDto {
  const nextDueOn = checkup.lastDoneOn
    ? isoAddMonths(checkup.lastDoneOn, checkup.everyMonths)
    : today;
  return { ...checkup, nextDueOn, overdue: nextDueOn < today };
}

export function offlineExplanation(
  list: readonly TestSeriesDto[],
): ResultsExplainerOutput {
  if (!list.length)
    return {
      summary:
        'There are no results yet. Add the values from your last blood tests to see them over time.',
      items: [],
      askTheDoctor: [],
      lifestyle: [],
    };
  const latest = list.map((s) => ({ s, last: s.points[s.points.length - 1] }));
  const out = latest.filter(
    (x) => x.last.flag === 'low' || x.last.flag === 'high',
  );
  const moving = latest.filter(
    (x) => x.s.trend === 'up' || x.s.trend === 'down',
  );
  const picked = [...new Set([...out, ...moving])].slice(0, 8);
  return {
    summary:
      `${list.length} test${list.length === 1 ? '' : 's'} recorded; ${out.length} out of the range printed on the report.` +
      ' A value slightly out of range is common and often means nothing on its own: your doctor reads it with the rest.',
    items: picked.map(({ s, last }) => ({
      test: s.test,
      meaning:
        last.flag === 'high'
          ? `The last value (${last.value}${s.unit ? ` ${s.unit}` : ''}) is above the range (${s.high}).`
          : last.flag === 'low'
            ? `The last value (${last.value}${s.unit ? ` ${s.unit}` : ''}) is below the range (${s.low}).`
            : `The last value (${last.value}${s.unit ? ` ${s.unit}` : ''}) is within the range.`,
      trend:
        s.trend === 'up'
          ? 'It went up since the previous test.'
          : s.trend === 'down'
            ? 'It went down since the previous test.'
            : s.points.length > 1
              ? 'Steady since the previous test.'
              : '',
    })),
    askTheDoctor: out
      .slice(0, 5)
      .map(
        ({ s }) =>
          `My ${s.test} is out of range: is it something to look at, and when should I test it again?`,
      ),
    lifestyle: [],
  };
}

export const EXPLAINER_INSTRUCTIONS = `You explain medical test results in plain language inside Life Island, a personal life organiser. You are not a doctor and must not diagnose.

You receive one person's test results over time: test name, value, unit, the reference range printed on the report, and the date. Write:
- summary: two or three calm sentences about the results as a whole.
- items: for each test that is out of range or clearly changing (at most eight): what the test measures, what this value may suggest in general terms, and how it moved over time.
- askTheDoctor: up to five specific questions worth asking their doctor.
- lifestyle: up to three general, safe habits related to these tests (diet, movement, sleep), only if relevant.

Rules: never diagnose, never suggest medicines or doses, never alarm. Say clearly when a value is only slightly out of range. Use only the values given. Plain English, no emojis. If the person asked a question, answer it within these fields and remind them the doctor decides.`;

export function explainerDossier(
  person: string | null,
  list: readonly TestSeriesDto[],
): string {
  const lines = [person ? `Results of ${person}:` : 'Results:'];
  for (const s of list.slice(0, 40)) {
    const range =
      s.low !== null || s.high !== null
        ? ` (range ${s.low ?? '—'}–${s.high ?? '—'})`
        : '';
    lines.push(
      `- ${s.test}${s.unit ? ` [${s.unit}]` : ''}${range}: ${s.points
        .slice(-5)
        .map(
          (p) =>
            `${p.date} ${p.value}${p.flag === 'high' ? ' H' : p.flag === 'low' ? ' L' : ''}`,
        )
        .join('; ')}`,
    );
  }
  return lines.join('\n');
}
