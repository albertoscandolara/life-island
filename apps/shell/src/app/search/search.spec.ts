import type { AgendaEntryDto, EntityRefDto } from '@life-island/contracts';
import { ISLAND_MODULES } from '../hub/modules';
import {
  areaItems,
  dateItems,
  entityItems,
  readRecent,
  rememberRecent,
  searchIsland,
  searchScore,
  searchText,
  shortcutLabel,
  type SearchItem,
} from './search';

const item = (title: string, extra: Partial<SearchItem> = {}): SearchItem => ({
  id: title,
  group: 'area',
  emblem: '•',
  title,
  detail: null,
  keywords: [],
  path: '/',
  rank: 0,
  ...extra,
});

const entity = (over: Partial<EntityRefDto>): EntityRefDto => ({
  kind: 'person',
  id: 'p1',
  name: 'Anna Rossi',
  status: 'confirmed',
  detail: null,
  aliases: [],
  ...over,
});

const entry = (over: Partial<AgendaEntryDto>): AgendaEntryDto => ({
  key: 'item:1:2026-12-01',
  source: 'item',
  module: 'agenda',
  kind: 'item',
  title: 'Call the plumber',
  detail: null,
  date: '2026-12-01',
  time: null,
  amount: null,
  path: null,
  daysLeft: 13,
  urgency: 'later',
  handled: false,
  autoPaid: false,
  itemId: '1',
  category: 'home',
  ...over,
});

describe('searchText', () => {
  it('drops case, accents and punctuation', () => {
    expect(searchText("Già, l'IMU!")).toBe('gia l imu');
  });
});

describe('searchScore', () => {
  it('needs every word of the query', () => {
    expect(searchScore(item('Anna Rossi'), 'anna')).toBeGreaterThan(0);
    expect(searchScore(item('Anna Rossi'), 'anna bianchi')).toBe(0);
  });

  it('ranks the start of the name over a word inside it', () => {
    const start = searchScore(item('Rossi Anna'), 'ross');
    const inside = searchScore(item('Anna Rossi'), 'ross');
    const nested = searchScore(item('Barossi'), 'ross');
    expect(start).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(nested);
    expect(nested).toBeGreaterThan(0);
  });

  it('needs four letters to match inside a word', () => {
    expect(searchScore(item('Companies'), 'pan')).toBe(0);
    expect(searchScore(item('Companies'), 'pani')).toBeGreaterThan(0);
  });

  it('finds a name by an alias or its detail, below the name itself', () => {
    const byAlias = searchScore(
      item('Panda', { keywords: ['AB123CD'] }),
      'ab123',
    );
    expect(byAlias).toBeGreaterThan(0);
    expect(byAlias).toBeLessThan(searchScore(item('AB123CD'), 'ab123'));
  });

  it('finds accented names without the accent', () => {
    expect(searchScore(item('Niccolò'), 'niccolo')).toBeGreaterThan(0);
  });
});

describe('searchIsland', () => {
  it('keeps the groups in order and the best first in each', () => {
    const found = searchIsland('cars', [
      item('Cars wash', { group: 'date', rank: 3 }),
      item('Cars'),
      item('Cars tax', { group: 'date', rank: 1 }),
      item('Oscars'),
    ]);
    expect(found.map((f) => f.title)).toEqual([
      'Cars',
      'Oscars',
      'Cars tax',
      'Cars wash',
    ]);
  });

  it('shows a repeating date once, at its nearest', () => {
    const found = searchIsland('rent', [
      item('Rent', { group: 'date', id: 'b', rank: 40 }),
      item('Rent', { group: 'date', id: 'a', rank: 10 }),
    ]);
    expect(found.map((f) => f.id)).toEqual(['a']);
  });

  it('caps each group', () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`Bill ${i}`));
    expect(searchIsland('bill', many, 4)).toHaveLength(4);
  });

  it('finds nothing for an empty query', () => {
    expect(searchIsland('  ', [item('Anything')])).toEqual([]);
  });
});

describe('areaItems', () => {
  it('leaves out hidden and planned areas, never Settings', () => {
    const items = areaItems(ISLAND_MODULES, new Set(['cars', 'settings']));
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain('area:cars');
    expect(ids).toContain('area:settings');
    expect(ids).toContain('page:companies');
    expect(items.every((i) => i.path.startsWith('/'))).toBe(true);
  });

  it('finds an area by a word of its mission', () => {
    const found = searchIsland(
      'revisione',
      areaItems(ISLAND_MODULES, new Set()),
    );
    expect(found[0]?.id).toBe('area:cars');
  });
});

describe('entityItems', () => {
  it('opens a confirmed entity on its page and a pending one in review', () => {
    const [confirmed, pending] = entityItems([
      entity({}),
      entity({ kind: 'vehicle', id: 's1', name: 'Panda', status: 'pending' }),
    ]);
    expect(confirmed.path).toBe('/people?person=p1');
    expect(pending.path).toBe('/cars?review=entities');
    expect(pending.detail).toBe('Car · to confirm');
    expect(pending.rank).toBeGreaterThan(confirmed.rank);
  });
});

describe('dateItems', () => {
  const area = () => ({ name: 'My items', emblem: '🗓️' });

  it('ranks the dates ahead nearest first, then the past ones', () => {
    const items = dateItems(
      [
        entry({ key: 'a', daysLeft: 30 }),
        entry({ key: 'b', daysLeft: -2 }),
        entry({ key: 'c', daysLeft: 0 }),
      ],
      () => 'when',
      area,
    ).sort((x, y) => x.rank - y.rank);
    expect(items.map((i) => i.id)).toEqual(['date:c', 'date:a', 'date:b']);
  });

  it('opens the date where its area shows it, or the Agenda', () => {
    const [own, area2] = dateItems(
      [entry({}), entry({ key: 'm', path: '/cars?car=1' })],
      (e) => e.date,
      area,
    );
    expect(own.path).toBe('/agenda?tab=ahead');
    expect(own.detail).toBe('2026-12-01 · My items');
    expect(area2.path).toBe('/cars?car=1');
  });
});

describe('shortcutLabel', () => {
  it('says ⌘K on a Mac and Ctrl K elsewhere', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘K');
    expect(shortcutLabel('Win32')).toBe('Ctrl K');
  });
});

describe('recent searches', () => {
  it('puts the last pick first, once, and keeps five', () => {
    let recent: SearchItem[] = [];
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'c'])
      recent = rememberRecent(recent, item(t, { keywords: ['long text'] }));
    expect(recent.map((r) => r.id)).toEqual(['c', 'f', 'e', 'd', 'b']);
    expect(recent[0].keywords).toEqual([]);
  });

  it('reads back only well-formed items with a path in this app', () => {
    const raw = JSON.stringify([
      item('Cars', { path: '/cars' }),
      {
        id: 'x',
        title: 'Bad',
        path: 'https://evil.example',
        emblem: '•',
        group: 'area',
      },
      {
        id: 'y',
        title: 'Bad',
        path: '//evil.example',
        emblem: '•',
        group: 'area',
      },
      { id: 'z' },
      'text',
    ]);
    expect(readRecent(raw).map((r) => r.id)).toEqual(['Cars']);
    expect(readRecent('not json')).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });
});
