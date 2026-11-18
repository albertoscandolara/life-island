import {
  ENTITY_KIND_LABELS,
  entityPath,
  type AgendaEntryDto,
  type EntityRefDto,
} from '@life-island/contracts';
import type { IslandModule } from '../hub/modules';

/*
 * The arithmetic of the island's search: what can be found (areas, pages,
 * the people, houses, cars and workplaces of every area, and the dates of
 * the Agenda), and how a query finds and ranks it.
 */

export type SearchGroup = 'area' | 'entity' | 'date';

export const SEARCH_GROUP_LABELS: Record<SearchGroup, string> = {
  area: 'Areas and pages',
  entity: 'People, houses, cars and companies',
  date: 'Dates',
};

export interface SearchItem {
  /** Unique in the list. */
  id: string;
  group: SearchGroup;
  emblem: string;
  title: string;
  detail: string | null;
  /** Other words that find it: a plate, an alias, the area's mission. */
  keywords: readonly string[];
  /** Where it opens, in this app. */
  path: string;
  /** Lower comes first among equal matches: the days to a date. */
  rank: number;
}

/** Lower case, no accents or punctuation: "Già, l'IMU" → "gia l imu". */
export function searchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** How well an item answers the query; 0 when a word of the query is missing. */
export function searchScore(item: SearchItem, query: string): number {
  const words = searchText(query).split(' ').filter(Boolean);
  if (!words.length) return 0;
  const title = searchText(item.title);
  const titleWords = title.split(' ');
  const rest = searchText(
    [item.detail ?? '', ...item.keywords].join(' '),
  ).split(' ');
  let score = 0;
  for (const word of words) {
    if (titleWords.some((w) => w.startsWith(word))) score += 4;
    // Inside a word only from four letters: "pan" should not find "Companies".
    else if (word.length >= 4 && title.includes(word)) score += 2;
    else if (rest.some((w) => w.startsWith(word))) score += 1;
    else return 0;
  }
  // The whole query at the start of the name: "anna" for "Anna Rossi".
  if (title.startsWith(words.join(' '))) score += 3;
  return score;
}

/**
 * The items that answer a query, best first within each group, at most
 * `perGroup` a group, groups in the order of SEARCH_GROUP_LABELS. A date that
 * repeats (a monthly bill) shows once, at its nearest.
 */
export function searchIsland(
  query: string,
  items: readonly SearchItem[],
  perGroup = 6,
): SearchItem[] {
  const scored = items
    .map((item) => ({ item, score: searchScore(item, query) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.rank - b.item.rank ||
        a.item.title.localeCompare(b.item.title),
    );
  const seen = new Set<string>();
  const unique = scored.filter(({ item }) => {
    if (item.group !== 'date') return true;
    const key = `${item.emblem}|${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (Object.keys(SEARCH_GROUP_LABELS) as SearchGroup[]).flatMap((group) =>
    unique
      .filter((s) => s.item.group === group)
      .slice(0, perGroup)
      .map((s) => s.item),
  );
}

/** Pages that are not an area of their own. */
const PAGES: readonly Omit<SearchItem, 'group' | 'rank'>[] = [
  {
    id: 'page:companies',
    emblem: '🏢',
    title: 'Companies',
    detail: 'Every company your documents name: banks, insurers, employers',
    keywords: ['organizations', 'suppliers', 'banks'],
    path: '/companies',
  },
  {
    id: 'page:account',
    emblem: '👤',
    title: 'Account',
    detail: 'Your name, sign-in and sessions',
    keywords: ['profile', 'password', 'sign out', 'logout'],
    path: '/account',
  },
  {
    id: 'page:digest',
    emblem: '✉️',
    title: 'Email digest',
    detail: 'Agenda · the dates of the week, in your mailbox',
    keywords: ['email', 'mail', 'newsletter', 'weekly'],
    path: '/agenda?tab=email',
  },
  {
    id: 'page:my-items',
    emblem: '📝',
    title: 'My reminders',
    detail: 'Agenda · the dates you added yourself',
    keywords: ['items', 'reminders', 'todo', 'birthdays'],
    path: '/agenda?tab=items',
  },
];

/** The areas you can open (the ones you hid left out), and the other pages. */
export function areaItems(
  modules: readonly IslandModule[],
  hidden: ReadonlySet<string>,
): SearchItem[] {
  const areas = modules
    .filter(
      (m): m is IslandModule & { path: string } =>
        !!m.path && (m.id === 'settings' || !hidden.has(m.id)),
    )
    .map((m, i) => ({
      id: `area:${m.id}`,
      group: 'area' as const,
      emblem: m.emblem,
      title: m.name,
      detail: null,
      keywords: [m.islandName ?? '', m.id, m.mission],
      path: m.path,
      rank: i,
    }));
  const pages = PAGES.map((p, i) => ({
    ...p,
    group: 'area' as const,
    rank: areas.length + i,
  }));
  return [...areas, ...pages];
}

const KIND_EMBLEMS: Record<EntityRefDto['kind'], string> = {
  person: '🪪',
  house: '🏡',
  vehicle: '🚗',
  organization: '🏢',
  workplace: '💼',
};

/** Every entity of every area; one still to confirm opens its review. */
export function entityItems(entities: readonly EntityRefDto[]): SearchItem[] {
  return entities.map((e) => ({
    id: `entity:${e.kind}:${e.id}`,
    group: 'entity',
    emblem: KIND_EMBLEMS[e.kind] ?? '•',
    title: e.name,
    detail: [
      ENTITY_KIND_LABELS[e.kind],
      e.detail,
      e.status === 'pending' ? 'to confirm' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    keywords: e.aliases,
    path: entityPath(e),
    rank: e.status === 'confirmed' ? 0 : 1,
  }));
}

/**
 * The Agenda's dates, the nearest first: the ones ahead, then the ones past.
 * `when` writes a date and its distance, e.g. "Mon 3 Nov · in 12 days".
 */
export function dateItems(
  entries: readonly AgendaEntryDto[],
  when: (entry: AgendaEntryDto) => string,
  area: (module: string) => { name: string; emblem: string },
): SearchItem[] {
  return entries.map((e) => {
    const from = area(e.module);
    return {
      id: `date:${e.key}`,
      group: 'date',
      emblem: from.emblem,
      title: e.title,
      detail: [when(e), from.name, e.detail].filter(Boolean).join(' · '),
      keywords: [from.name, e.kind],
      path: e.path ?? '/agenda?tab=ahead',
      // Ahead before past, then the nearest.
      rank: e.daysLeft >= 0 ? e.daysLeft : 1000 - e.daysLeft,
    };
  });
}

/** The search shortcut as this keyboard writes it: ⌘K on a Mac, Ctrl K elsewhere. */
export function shortcutLabel(
  platform = globalThis.navigator?.platform ?? '',
): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/** The browser key of what you opened from search, newest first. */
export const RECENT_SEARCH_KEY = 'li.search.recent';
const RECENT_MAX = 5;

/** The list with `item` first, once, at most five long. */
export function rememberRecent(
  recent: readonly SearchItem[],
  item: SearchItem,
): SearchItem[] {
  const kept: SearchItem = { ...item, keywords: [] };
  return [kept, ...recent.filter((r) => r.id !== item.id)].slice(0, RECENT_MAX);
}

/** What was stored, the entries that are not search items left out. */
export function readRecent(raw: string | null): SearchItem[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (r): r is SearchItem =>
          !!r &&
          typeof r.id === 'string' &&
          typeof r.title === 'string' &&
          typeof r.path === 'string' &&
          r.path.startsWith('/') &&
          !r.path.startsWith('//') &&
          typeof r.emblem === 'string' &&
          (r.group === 'area' || r.group === 'entity' || r.group === 'date'),
      )
      .map((r) => ({
        ...r,
        detail: typeof r.detail === 'string' ? r.detail : null,
        keywords: [],
        rank: 0,
      }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
