/** One area of life on the island, run by a character (docs/architecture.md, Vision). */
export interface IslandModule {
  id: string;
  /** The character theme (`[data-character]`); null for an area not built yet. */
  character: 'trice' | 'ankylo' | null;
  emblem: string;
  name: string;
  mission: string;
  /** Route in this app, served by the area's remote; null while it is planned. */
  path: string | null;
  /** Where its zone sits on the island, as an angle around the centre (degrees). */
  angle: number;
  /** What its zone's landmark looks like in 3D. */
  landmark: 'vault' | 'market' | 'clinic' | 'office' | 'lighthouse' | 'library';
}

/**
 * Every area of life the island will handle. Each one is its own service and
 * front-end module; an area without a path is planned and shows as "coming soon".
 */
export const ISLAND_MODULES: readonly IslandModule[] = [
  {
    id: 'taxes',
    character: 'ankylo',
    emblem: '🦖',
    name: '730 & taxes',
    mission:
      'Every document of your 730, year by year: deductible expenses, invoices, payment proofs and the folder for the commercialista.',
    path: '/taxes/730',
    angle: 90,
    landmark: 'vault',
  },
  {
    id: 'groceries',
    character: 'trice',
    emblem: '🦕',
    name: 'Groceries',
    mission:
      'Receipts, items and shops: spending by category and price history.',
    path: null,
    angle: 30,
    landmark: 'market',
  },
  {
    id: 'health',
    character: null,
    emblem: '🩺',
    name: 'Health',
    mission: 'Visits, prescriptions, test results and medical expenses.',
    path: null,
    angle: 330,
    landmark: 'clinic',
  },
  {
    id: 'work',
    character: null,
    emblem: '💼',
    name: 'Work',
    mission:
      'Payslips, contracts and the Certificazione Unica, year after year.',
    path: null,
    angle: 270,
    landmark: 'office',
  },
  {
    id: 'bills',
    character: null,
    emblem: '💡',
    name: 'Bills & home',
    mission:
      'Electricity, gas, water and internet: consumption and costs over time.',
    path: null,
    angle: 210,
    landmark: 'lighthouse',
  },
  {
    id: 'studies',
    character: null,
    emblem: '📚',
    name: 'Studies',
    mission: 'Courses, certificates, exams and what they cost.',
    path: null,
    angle: 150,
    landmark: 'library',
  },
];
