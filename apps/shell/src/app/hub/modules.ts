/** One area of life on the island, run by a character (docs/architecture.md, Vision). */
export interface IslandModule {
  character: 'trice' | 'ankylo';
  emblem: string;
  name: string;
  mission: string;
  /** Route in this app once the module's remote exists; null while it is planned. */
  path: string | null;
}

export const ISLAND_MODULES: readonly IslandModule[] = [
  {
    character: 'trice',
    emblem: '🦕',
    name: 'Groceries',
    mission:
      'Receipts, items and shops: spending by category and price history.',
    path: null,
  },
  {
    character: 'ankylo',
    emblem: '🦖',
    name: '730 tax return',
    mission:
      'Deductible expenses per tax year, running totals and an export for the CAF.',
    path: null,
  },
];
