import { Logger } from '@nestjs/common';
import {
  DREAM_CONTEXT_SOURCES,
  type DreamContextArea,
  type DreamContextAreaDto,
  type DreamContextDto,
  type DreamContextFactDto,
  type DreamSafetyNetDto,
  type FitnessOverviewDto,
  type GoalsOverviewDto,
  type MoneyOverviewDto,
  type StudiesOverviewDto,
  type TravelOverviewDto,
  type WorkOverviewDto,
} from '@life-island/contracts';
import { euroText as euroMoney } from '@life-island/contracts';

/*
 * What the other areas of the island say about you, for one dream: read over
 * HTTP from each area's own `GET /overview` (principle 2), only for the areas
 * you ticked on the dream, and boiled down to a few facts. Only these facts
 * reach Claude: no names of companies, people or places. An area that is not
 * running answers nothing within the timeout, and the dream still works.
 */

const TIMEOUT_MS = 5000;
const logger = new Logger('DreamContext');

/** Whole euros, as every page writes them ("36.000 €"). */
export const euroText = (value: number): string => euroMoney(value, false);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Months as "2 years and 3 months". */
export function monthsText(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return plural(rest, 'month');
  return rest
    ? `${plural(years, 'year')} and ${plural(rest, 'month')}`
    : plural(years, 'year');
}

export function moneySafetyNet(
  money: MoneyOverviewDto,
  today: string,
): DreamSafetyNetDto {
  const thisMonth = today.slice(0, 7);
  const full = money.months.filter((m) => m.month < thisMonth).slice(-3);
  const spent = full.filter((m) => m.spending > 0);
  const monthlySpending = spent.length
    ? spent.reduce((sum, m) => sum + m.spending, 0) / spent.length
    : null;
  const balance = money.accounts.length ? money.totals.balance : null;
  return {
    balance,
    monthlySpending,
    runwayMonths:
      balance !== null && monthlySpending
        ? Math.max(0, Math.round((balance / monthlySpending) * 10) / 10)
        : null,
    savingsRate: money.totals.savingsRate,
  };
}

export function moneyFacts(net: DreamSafetyNetDto): DreamContextFactDto[] {
  const facts: DreamContextFactDto[] = [];
  if (net.balance !== null)
    facts.push({
      label: 'Balance of your accounts',
      value: euroText(net.balance),
    });
  if (net.monthlySpending !== null)
    facts.push({
      label: 'A usual month costs you',
      value: `${euroText(net.monthlySpending)} (last 3 full months)`,
    });
  if (net.runwayMonths !== null)
    facts.push({
      label: 'Safety net',
      value: `${net.runwayMonths.toLocaleString('en-GB')} months of your usual spending`,
    });
  if (net.savingsRate !== null)
    facts.push({
      label: 'You keep',
      value: `${Math.round(net.savingsRate * 100)}% of what comes in`,
    });
  return facts;
}

export function workFacts(work: WorkOverviewDto): DreamContextFactDto[] {
  const { stats, jobSearch } = work;
  const facts: DreamContextFactDto[] = [];
  if (stats.tenureMonths !== null)
    facts.push({
      label: 'At your current job for',
      value: monthsText(stats.tenureMonths),
    });
  if (stats.careerMonths !== null)
    facts.push({
      label: 'Working in total',
      value: monthsText(stats.careerMonths),
    });
  if (stats.monthsSinceLastRise !== null)
    facts.push({
      label: 'Last rise or promotion',
      value: `${monthsText(stats.monthsSinceLastRise)} ago`,
    });
  if (stats.currentMonthlySalary !== null)
    facts.push({
      label: 'Monthly salary (gross)',
      value: euroText(stats.currentMonthlySalary),
    });
  if (stats.currentLevel)
    facts.push({ label: 'Contract level', value: stats.currentLevel });
  // A pension fund is savings tied up until retirement: part of the net, not of the cash.
  const pension = work.pension;
  if (pension?.totalValue != null)
    facts.push({
      label: 'Pension fund (tied up until retirement)',
      value: euroText(pension.totalValue),
    });
  else if (pension?.onPayslips)
    facts.push({
      label: 'Pension fund',
      value: `${euroText(pension.totalPaidIn)} paid in on record, tied up until retirement`,
    });
  if (jobSearch.total)
    facts.push({
      label: 'Job applications',
      value: `${jobSearch.active} active, ${plural(jobSearch.interviews, 'interview')}, ${plural(jobSearch.offers, 'offer')}`,
    });
  return facts;
}

export function studiesFacts(
  studies: StudiesOverviewDto,
): DreamContextFactDto[] {
  const facts: DreamContextFactDto[] = [];
  const names = new Map(studies.catalogue.map((p) => [p.id, p.name]));
  for (const path of studies.paths
    .filter((p) => p.status === 'following')
    .slice(0, 4))
    facts.push({
      label: `Following “${names.get(path.pathId) ?? path.pathId}”`,
      value: `${path.doneSteps} of ${path.totalSteps} steps done`,
    });
  facts.push({
    label: 'Study time',
    value: `about ${Math.round(studies.stats.averageWeekMinutes / 6) / 10} h a week (goal ${studies.stats.weeklyGoalHours} h)`,
  });
  if (studies.stats.coursesInProgress)
    facts.push({
      label: 'Courses in progress',
      value: String(studies.stats.coursesInProgress),
    });
  return facts;
}

export function fitnessFacts(
  fitness: FitnessOverviewDto,
): DreamContextFactDto[] {
  const facts: DreamContextFactDto[] = [
    {
      label: 'Active minutes',
      value: `${Math.round(fitness.stats.averageLast4)} a week lately (goal ${fitness.goalMinutes})`,
    },
  ];
  if (fitness.stats.averageSleep7 !== null)
    facts.push({
      label: 'Sleep',
      value: `${fitness.stats.averageSleep7.toFixed(1)} h a night this week`,
    });
  const next = fitness.events.find((e) => !e.done && e.daysToGo >= 0);
  if (next)
    facts.push({
      label: 'Next event',
      value: `in ${plural(next.daysToGo, 'day')}`,
    });
  return facts;
}

export function travelFacts(travel: TravelOverviewDto): DreamContextFactDto[] {
  const facts: DreamContextFactDto[] = [
    { label: 'Trips ahead', value: String(travel.totals.upcoming) },
    {
      label: 'Spent on travel this year',
      value: euroText(travel.totals.spentThisYear),
    },
  ];
  const next = travel.trips
    .filter((t) => t.daysToGo !== null && t.daysToGo >= 0)
    .sort((a, b) => (a.daysToGo ?? 0) - (b.daysToGo ?? 0))[0];
  if (next?.daysToGo !== null && next?.daysToGo !== undefined)
    facts.push({
      label: 'Next trip',
      value: `in ${plural(next.daysToGo, 'day')}`,
    });
  return facts;
}

export function goalsFacts(goals: GoalsOverviewDto): DreamContextFactDto[] {
  const active = goals.goals.filter((g) => g.status === 'active');
  const facts: DreamContextFactDto[] = [
    {
      label: 'Active goals',
      value: `${active.length}, ${active.filter((g) => g.stuck).length} of them stuck`,
    },
  ];
  for (const g of active.slice(0, 4))
    facts.push({
      label: g.title.slice(0, 80),
      value:
        g.progress === null ? 'no steps yet' : `${g.progress}% of its steps`,
    });
  return facts;
}

async function readOverview<T>(
  base: string,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`${base}/overview`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Reads the areas a dream shares, in the order of DREAM_CONTEXT_SOURCES. */
export async function readDreamContext(
  areas: readonly DreamContextArea[],
  sources: Readonly<Record<string, string>>,
  today: string,
  fetcher: typeof fetch = fetch,
): Promise<DreamContextDto> {
  let safetyNet: DreamSafetyNetDto | null = null;
  const order = Object.keys(DREAM_CONTEXT_SOURCES) as DreamContextArea[];
  const results = await Promise.all(
    order
      .filter((area) => areas.includes(area))
      .map(async (area): Promise<DreamContextAreaDto> => {
        const meta = DREAM_CONTEXT_SOURCES[area];
        const out: DreamContextAreaDto = {
          area,
          name: meta.name,
          emblem: meta.emblem,
          reachable: false,
          error: null,
          facts: [],
        };
        const base = sources[area];
        if (!base) {
          out.error = 'Not configured (DREAMS_SOURCES)';
          return out;
        }
        try {
          switch (area) {
            case 'money': {
              const net = moneySafetyNet(
                await readOverview<MoneyOverviewDto>(base, fetcher),
                today,
              );
              safetyNet = net;
              out.facts = moneyFacts(net);
              break;
            }
            case 'work':
              out.facts = workFacts(await readOverview(base, fetcher));
              break;
            case 'studies':
              out.facts = studiesFacts(await readOverview(base, fetcher));
              break;
            case 'fitness':
              out.facts = fitnessFacts(await readOverview(base, fetcher));
              break;
            case 'travel':
              out.facts = travelFacts(await readOverview(base, fetcher));
              break;
            case 'goals':
              out.facts = goalsFacts(await readOverview(base, fetcher));
              break;
          }
          out.reachable = true;
        } catch (error) {
          out.error = describe(error);
          logger.debug(`${area}: ${out.error}`);
        }
        return out;
      }),
  );
  return { areas: results, safetyNet };
}

function describe(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError')
    return 'Did not answer in time';
  const message = String((error as Error)?.message ?? error);
  if (/ECONNREFUSED|fetch failed/i.test(message)) return 'Not running';
  if (/TypeError|Cannot read/i.test(message))
    return 'Answered in an unexpected shape';
  return message.slice(0, 120);
}

/** The facts as the lines Claude reads. */
export function contextLines(context: DreamContextDto): string[] {
  const lines: string[] = [];
  for (const area of context.areas.filter(
    (a) => a.reachable && a.facts.length,
  )) {
    lines.push(`${area.name}:`);
    for (const fact of area.facts) lines.push(`- ${fact.label}: ${fact.value}`);
  }
  return lines;
}
