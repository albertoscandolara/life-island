/** One area of life on the island, run by a character (docs/architecture.md, Vision). */
export interface IslandModule {
  id: string;
  /** The character theme (`[data-character]`); null for an area not built yet. */
  character:
    | 'trice'
    | 'ankylo'
    | 'bronto'
    | 'stego'
    | 'para'
    | 'velo'
    | 'pachy'
    | 'archie'
    | null;
  emblem: string;
  name: string;
  mission: string;
  /** Route in this app, served by the area's remote; null while it is planned. */
  path: string | null;
  /**
   * The area's API that says what needs you (expired, expiring, to review),
   * shown as a badge on its card; the gateway serves it under /api.
   */
  attentionUrl?: string;
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
    | 'gate'
    | 'garage';
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
    character: 'pachy',
    emblem: '💼',
    name: 'Work',
    mission:
      'Every workplace you have had, read from payslips, evaluations and contracts: a timeline of promotions and rises, your pay year by year, an AI feedback on your career, and the hiring platforms you signed up to.',
    path: '/work',
    angle: 315,
    landmark: 'office',
  },
  {
    id: 'home',
    character: 'bronto',
    emblem: '🏡',
    name: 'Houses',
    mission:
      'Every house you have, as you know it and as your documents tell it: its data, owners and companies, its renovations and its electricity, gas and water bills.',
    path: '/home',
    angle: 250,
    landmark: 'house',
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
    attentionUrl: '/api/people/attention',
    angle: 135,
    landmark: 'gate',
  },
  {
    id: 'cars',
    character: 'velo',
    emblem: '🚗',
    name: 'Cars',
    mission:
      'Every car you have, read from its registration certificate with every code explained: insurance, road tax and revisione with a warning before they expire, and what each car costs, from fuel to the mechanic.',
    path: '/cars',
    angle: 215,
    landmark: 'garage',
  },
  {
    id: 'settings',
    character: 'archie',
    emblem: '⚙️',
    name: 'Settings',
    mission:
      'Every setting of the island in one place, and every tool that uses AI, module by module: what one use costs, the request it sends, and a switch to turn it off.',
    path: '/settings',
    angle: 285,
    landmark: 'lighthouse',
  },
];
