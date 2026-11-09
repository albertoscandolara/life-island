import type { Tax730ExpenseType } from './targets/tax730-expense.js';

/**
 * How each kind of expense is deducted in the 730, by the year the money was
 * spent (the 730/2026 covers expenses of 2025). Sources: Agenzia delle Entrate
 * instructions for the 730/2026 and the 2025 and 2026 budget laws (Legge di
 * Bilancio). These are estimates for planning; the commercialista decides.
 */
export const TAX730_DEDUCTION_GROUPS = [
  'health',
  'veterinary',
  'education',
  'sport_kids',
  'mortgage_interest',
  'insurance',
  'agency_fees',
  'renovation',
  'energy_efficiency',
  'furniture',
  'other',
] as const;
export type Tax730DeductionGroup = (typeof TAX730_DEDUCTION_GROUPS)[number];

/** Who a spending cap applies to. */
export type Tax730CapScope =
  | 'year' // the whole return, every year
  | 'person' // each person the expense is for (each child, each student)
  | 'unit' // each property, across the years of the same works
  | 'intervention'; // each kind of works, as the law lists them

export interface Tax730DeductionRule {
  group: Tax730DeductionGroup;
  label: { en: string; it: string };
  types: Tax730ExpenseType[];
  /** Where it goes in the 730 (Quadro E). */
  row730: string;
  /** Share of the eligible spending you get back, e.g. 0.19. Null: not deductible as such. */
  rate: number | null;
  /** The lower rate when the condition does not hold (e.g. not your main home). */
  reducedRate: { rate: number; when: string } | null;
  /** Spending that counts at most; null when there is no cap. */
  cap: number | null;
  capScope: Tax730CapScope | null;
  /** Spending that never counts (the first €129.11 of health expenses). */
  franchigia: number | null;
  /** Years the deduction is spread over: 1, or 10 for the home bonuses. */
  instalments: number;
  /** Cash payments do not count: card, bank transfer, cheque (or "bonifico parlante" for home bonuses). */
  traceable: 'required' | 'not_required' | 'partly';
  /** Counted in the cap that applies above €75,000 of income (from 2025). */
  incomeCapped: boolean;
  notes: string[];
}

const HEALTH_FRANCHIGIA = 129.11;

/** Building bonuses by the year of the expense: main-home rate, other rate. */
function homeRates(taxYear: number): { main: number; other: number } {
  if (taxYear <= 2024) return { main: 0.5, other: 0.5 };
  if (taxYear <= 2026) return { main: 0.5, other: 0.36 };
  return { main: 0.36, other: 0.3 };
}

/** Every rule, for expenses paid in `taxYear`. */
export function tax730DeductionRules(taxYear: number): Tax730DeductionRule[] {
  const home = homeRates(taxYear);
  const homeReduced =
    home.other !== home.main
      ? { rate: home.other, when: 'not your main home (abitazione principale)' }
      : null;
  return [
    {
      group: 'health',
      label: { en: 'Health', it: 'Spese sanitarie' },
      types: ['medical', 'medicines', 'medical_devices'],
      row730: 'E1',
      rate: 0.19,
      reducedRate: null,
      cap: null,
      capScope: null,
      franchigia: HEALTH_FRANCHIGIA,
      instalments: 1,
      traceable: 'partly',
      incomeCapped: false,
      notes: [
        'No cap; the first €129.11 of the year never counts.',
        'Visits and treatments must be paid by card or transfer, unless done by the public health service or an accredited structure; medicines and medical devices can be paid in cash.',
        'Pharmacy receipts need your codice fiscale (scontrino parlante); devices need the CE mark.',
        'Above €15,493.71 you can spread the deduction over 4 years.',
      ],
    },
    {
      group: 'veterinary',
      label: { en: 'Veterinary', it: 'Spese veterinarie' },
      types: ['veterinary'],
      row730: 'E8-E10 (code 29)',
      rate: 0.19,
      reducedRate: null,
      cap: 550,
      capScope: 'year',
      franchigia: HEALTH_FRANCHIGIA,
      instalments: 1,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'At most €550, less the €129.11 franchigia: up to €79.97 back.',
        'Only pets kept for company or sport, not farm animals.',
      ],
    },
    {
      group: 'education',
      label: { en: 'Education', it: 'Istruzione' },
      types: ['education'],
      row730: 'E8-E10 (code 12, 13)',
      rate: 0.19,
      reducedRate: null,
      cap: 800,
      capScope: 'person',
      franchigia: null,
      instalments: 1,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'School fees, canteen and trips: €800 per student.',
        'Private universities have their own caps by subject and region; public ones count in full.',
        'Nursery (asilo nido) is code 33, €632 per child.',
      ],
    },
    {
      group: 'sport_kids',
      label: { en: "Children's sport", it: 'Sport ragazzi' },
      types: ['sport_kids'],
      row730: 'E8-E10 (code 16)',
      rate: 0.19,
      reducedRate: null,
      cap: 210,
      capScope: 'person',
      franchigia: null,
      instalments: 1,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'Children aged 5 to 18, at a sports club or gym: €210 per child.',
        'The receipt must name the club, the child and the payer.',
      ],
    },
    {
      group: 'mortgage_interest',
      label: { en: 'Mortgage interest', it: 'Interessi mutuo' },
      types: ['mortgage_interest'],
      row730: 'E7',
      rate: 0.19,
      reducedRate: null,
      cap: 4000,
      capScope: 'year',
      franchigia: null,
      instalments: 1,
      traceable: 'not_required',
      incomeCapped: true,
      notes: [
        'Mortgage to buy your main home: interest up to €4,000 (shared among the co-borrowers).',
        'Loans taken out before 2025 are outside the income cap.',
        'The bank sends the yearly interest statement.',
      ],
    },
    {
      group: 'insurance',
      label: { en: 'Insurance', it: 'Assicurazioni' },
      types: ['insurance'],
      row730: 'E8-E10 (code 36, 38, 43)',
      rate: 0.19,
      reducedRate: null,
      cap: 530,
      capScope: 'year',
      franchigia: null,
      instalments: 1,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'Life and accident policies: €530; long-term care (non autosufficienza): €1,291.14; disability risk: €750.',
        'Policies signed before 2025 are outside the income cap.',
      ],
    },
    {
      group: 'agency_fees',
      label: { en: 'Estate agent fees', it: 'Intermediazione immobiliare' },
      types: ['agency_fees'],
      row730: 'E8-E10 (code 11)',
      rate: 0.19,
      reducedRate: null,
      cap: 1000,
      capScope: 'year',
      franchigia: null,
      instalments: 1,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'Agency fee for buying your main home: €1,000, shared among the buyers.',
      ],
    },
    {
      group: 'renovation',
      label: {
        en: 'Home renovation',
        it: 'Ristrutturazione edilizia (bonus casa)',
      },
      types: ['renovation'],
      row730: 'E41-E43',
      rate: home.main,
      reducedRate: homeReduced,
      cap: 96000,
      capScope: 'unit',
      franchigia: null,
      instalments: 10,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        `${Math.round(home.main * 100)}% on your main home${homeReduced ? `, ${Math.round(home.other * 100)}% on other homes` : ''}, over 10 yearly instalments.`,
        '€96,000 per property, including what you spent in earlier years on the same works.',
        'Pay by "bonifico parlante" (transfer naming the law, your codice fiscale and the firm\'s VAT number); a plain transfer loses the bonus.',
      ],
    },
    {
      group: 'energy_efficiency',
      label: {
        en: 'Energy efficiency',
        it: 'Riqualificazione energetica (ecobonus)',
      },
      types: ['energy_efficiency'],
      row730: 'E61-E62',
      rate: taxYear <= 2024 ? 0.65 : home.main,
      reducedRate: taxYear <= 2024 ? null : homeReduced,
      cap: null,
      capScope: 'intervention',
      franchigia: null,
      instalments: 10,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'Caps depend on the works (windows, boilers, insulation, solar panels); the ENEA filing within 90 days of the end of works is required.',
        'Pay by "bonifico parlante".',
      ],
    },
    {
      group: 'furniture',
      label: {
        en: 'Furniture and appliances',
        it: 'Bonus mobili ed elettrodomestici',
      },
      types: ['furniture'],
      row730: 'E57',
      rate: 0.5,
      reducedRate: null,
      cap: taxYear <= 2023 ? 8000 : 5000,
      capScope: 'unit',
      franchigia: null,
      instalments: 10,
      traceable: 'required',
      incomeCapped: true,
      notes: [
        'Only for a home with renovation works started from 1 January of the year before.',
        'Appliances of class A or better (A for ovens, E for washing machines, F for fridges); paid by card or transfer.',
      ],
    },
    {
      group: 'other',
      label: { en: 'Other', it: 'Altro' },
      types: ['other'],
      row730: '–',
      rate: null,
      reducedRate: null,
      cap: null,
      capScope: null,
      franchigia: null,
      instalments: 1,
      traceable: 'required',
      incomeCapped: false,
      notes: [
        'Not estimated: check with the commercialista which row it goes in.',
      ],
    },
  ];
}

/** The rule an expense type is deducted by. */
export function tax730RuleFor(
  expenseType: string,
  taxYear: number,
): Tax730DeductionRule {
  const rules = tax730DeductionRules(taxYear);
  return (
    rules.find((rule) => (rule.types as string[]).includes(expenseType)) ??
    rules[rules.length - 1]
  );
}

/** One line of a year's estimate: a group of expenses against its rule. */
export interface Tax730DeductionLineDto {
  group: Tax730DeductionGroup;
  label: string;
  labelIt: string;
  row730: string;
  rate: number | null;
  reducedRate: { rate: number; when: string } | null;
  cap: number | null;
  capScope: Tax730CapScope | null;
  franchigia: number | null;
  instalments: number;
  /** Everything spent this year in the group. */
  spent: number;
  expenseCount: number;
  /** Paid in cash where traceable payment is required: does not count. */
  excluded: number;
  /** What counts after the cap and the franchigia. */
  eligible: number;
  /** Spending over the cap: does not count. */
  overCap: number;
  /** How full the cap is: spent (traceable) over the cap; null with no cap. Above 1 is over. */
  capUsage: number | null;
  /** The cap that applies here: per person it is times the people. */
  effectiveCap: number | null;
  /** People the cap is counted for (distinct beneficiaries), for per-person caps. */
  people: number | null;
  /** The whole deduction this spending gives, over every instalment. */
  totalDeduction: number;
  /** What it gives in this year's 730: the whole of it, or one instalment of ten. */
  deduction: number;
  notes: string[];
}

/** One of the ten yearly instalments of home bonuses paid in an earlier year. */
export interface Tax730CarriedInstalmentDto {
  fromYear: number;
  group: Tax730DeductionGroup;
  label: string;
  labelIt: string;
  /** Which instalment this year's 730 gets: 2 of 10, for an expense of the year before. */
  instalment: number;
  of: number;
  amount: number;
}

/** What a year's expenses are worth in its 730: an estimate, never a promise. */
export interface Tax730DeductionsDto {
  lines: Tax730DeductionLineDto[];
  carried: Tax730CarriedInstalmentDto[];
  /** Tax back in this year's 730: every line's deduction plus the carried instalments. */
  thisYear: number;
  /** Instalments still to come in later 730s from this year's spending. */
  futureYears: number;
}
