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
    | 'iggy'
    | 'compy'
    | 'spino'
    | 'rex'
    | 'maia'
    | 'allo'
    | 'diplo'
    | 'quetzal'
    | 'galli'
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
    | 'garage'
    | 'clock'
    | 'coins'
    | 'flag'
    | 'antenna'
    | 'boat'
    | 'track';
}

/**
 * Every area of life the island will handle. The order is the order of the
 * cards and of the zones around the island (island-layout.ts): the first one
 * faces you, the others follow clockwise, evenly spaced. Each one is its own service and
 * front-end module; an area without a path is planned and shows as "coming soon".
 */
export const ISLAND_MODULES: readonly IslandModule[] = [
  {
    id: 'agenda',
    character: 'compy',
    emblem: '🗓️',
    name: 'Agenda',
    mission:
      'Every date of the island in one place: what is late, this week and the year ahead from every area, your own reminders, and a week brief.',
    path: '/agenda',
    attentionUrl: '/api/agenda/attention',
    landmark: 'clock',
  },
  {
    id: 'taxes',
    character: 'ankylo',
    emblem: '🦖',
    name: '730 & taxes',
    mission:
      'Every document of your 730, year by year: deductible expenses, invoices, payment proofs and the folder for the commercialista.',
    path: '/taxes/730',
    landmark: 'vault',
  },
  {
    id: 'groceries',
    character: 'trice',
    emblem: '🦕',
    name: 'Groceries',
    mission:
      'A shopping list that learns from your receipts, price history by shop, and spending by category.',
    path: '/groceries',
    landmark: 'market',
  },
  {
    id: 'health',
    character: 'maia',
    emblem: '🩺',
    name: 'Health',
    mission:
      'Check-ups by age, visits, medicines with refills, test results with their trend, vaccinations, and an explainer for your results.',
    path: '/health',
    attentionUrl: '/api/health/attention',
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
    landmark: 'house',
  },
  {
    id: 'studies',
    character: 'iggy',
    emblem: '📚',
    name: 'Studies',
    mission:
      'Learning paths for AI coding, other frameworks, Docker and Kubernetes, team leadership and 3D, with your progress step by step; courses, exams and the training platforms you use, what they cost, your study time against a weekly goal, and a coach that plans your week.',
    path: '/studies',
    attentionUrl: '/api/studies/attention',
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
    landmark: 'garage',
  },
  {
    id: 'money',
    character: 'spino',
    emblem: '💶',
    name: 'Money',
    mission:
      'Accounts and movements (from your bank CSV), monthly budgets, the recurring charges you pay, and a review of where the money goes.',
    path: '/money',
    attentionUrl: '/api/money/attention',
    landmark: 'coins',
  },
  {
    id: 'subscriptions',
    character: 'allo',
    emblem: '📑',
    name: 'Contracts & subscriptions',
    mission:
      'Every contract and subscription: what it costs a year, when it renews, the date to cancel by, its price history, and an advisor for renewals.',
    path: '/subscriptions',
    attentionUrl: '/api/subscriptions/attention',
    landmark: 'antenna',
  },
  {
    id: 'fitness',
    character: 'galli',
    emblem: '🏃',
    name: 'Fitness',
    mission:
      'Workouts as active minutes against a weekly goal, weight and sleep, the races ahead, and a training plan for the next weeks.',
    path: '/fitness',
    attentionUrl: '/api/fitness/attention',
    landmark: 'track',
  },
  {
    id: 'goals',
    character: 'rex',
    emblem: '🎯',
    name: 'Goals & habits',
    mission:
      'Where you want to go and the next step to get there, daily habits with streaks, a weekly review, and a coach for when you are stuck.',
    path: '/goals',
    attentionUrl: '/api/goals/attention',
    landmark: 'flag',
  },
  {
    id: 'travel',
    character: 'quetzal',
    emblem: '✈️',
    name: 'Travel',
    mission:
      'Trips with their bookings, a checklist and packing list, what each trip costs, and a planner that drafts the days and what to bring.',
    path: '/travel',
    attentionUrl: '/api/travel/attention',
    landmark: 'boat',
  },
  {
    id: 'settings',
    character: 'archie',
    emblem: '⚙️',
    name: 'Settings',
    mission:
      'Every setting of the island in one place, and every tool that uses AI, module by module: what one use costs, the request it sends, and a switch to turn it off.',
    path: '/settings',
    landmark: 'lighthouse',
  },
];
