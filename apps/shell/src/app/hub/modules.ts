/** One area of life on the island, run by a character (docs/architecture.md, Vision). */
export interface IslandModule {
  id: string;
  /** The character theme (`[data-character]`); null for an area not built yet. */
  character: 'trice' | 'ankylo' | 'bronto' | 'stego' | 'para' | null;
  emblem: string;
  name: string;
  mission: string;
  /** Route in this app, served by the area's remote; null while it is planned. */
  path: string | null;
  /** Where its zone sits on the island, as an angle around the centre (degrees). */
  angle: number;
  /** What its zone's landmark looks like in 3D. */
  landmark:
    | 'vault'
    | 'market'
    | 'clinic'
    | 'office'
    | 'lighthouse'
    | 'library'
    | 'house'
    | 'gate';
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
    angle: 45,
    landmark: 'market',
  },
  {
    id: 'health',
    character: null,
    emblem: '🩺',
    name: 'Health',
    mission: 'Visits, prescriptions, test results and medical expenses.',
    path: null,
    angle: 0,
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
    angle: 315,
    landmark: 'office',
  },
  {
    id: 'home',
    character: 'bronto',
    emblem: '🏡',
    name: 'Home',
    mission:
      'Every home you have, side by side: renovations, repairs and maintenance, with what they cost and their invoices.',
    path: '/home',
    angle: 270,
    landmark: 'house',
  },
  {
    id: 'bills',
    character: 'stego',
    emblem: '⚡',
    name: 'Bills',
    mission:
      'Electricity, gas and water of each home: what you pay and use, month by month and year over year.',
    path: '/home/bills',
    angle: 225,
    landmark: 'lighthouse',
  },
  {
    id: 'studies',
    character: null,
    emblem: '📚',
    name: 'Studies',
    mission: 'Courses, certificates, exams and what they cost.',
    path: null,
    angle: 180,
    landmark: 'library',
  },
  {
    id: 'people',
    character: 'para',
    emblem: '🪪',
    name: 'People & IDs',
    mission:
      'Identity cards, passports, health cards and licences of everyone at home: every version kept, a review before personal data changes, and a warning before one expires.',
    path: '/people',
    angle: 135,
    landmark: 'gate',
  },
];
