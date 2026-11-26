/*
 * Work, in plain words: the reading matter of the Work page, one topic per
 * subject, kept out of the sections so they stay about your own figures.
 * Italian rules as of 2026. Shown by `<work-guide-sections>`.
 */
import type { PensionGuideSection } from './pension-guide';

/** One question of a guide topic: paragraphs, then an optional list. */
export type WorkGuideSection = PensionGuideSection;

/** The topics of the Work guide, by their `?guide=` key. */
export const WORK_GUIDE_TOPICS = [
  'payslip',
  'tfr',
  'cu',
  'reviews',
  'pension',
] as const;
export type WorkGuideTopic = (typeof WORK_GUIDE_TOPICS)[number];

export const PAYSLIP_GUIDE: WorkGuideSection[] = [
  {
    id: 'parts',
    title: 'The three parts of a payslip',
    body: [
      'A payslip (cedolino, or busta paga) has the same three parts at every employer, whatever the layout: what you earned, what is taken away, and what is left.',
    ],
    points: [
      'Competenze: what you earned this month. Base pay (paga base or minimo), contingenza, seniority steps (scatti di anzianità), a superminimo if you negotiated one, overtime, allowances and bonuses.',
      'Trattenute: what is taken away. Your social security contributions (INPS, about 9.19% of the gross), the income tax IRPEF, the regional and municipal surcharges, and your contribution to a pension fund if you joined one.',
      'Netto in busta: what reaches your bank account. Money compares it with the transfer your employer made.',
    ],
  },
  {
    id: 'tax',
    title: 'Why the tax changes from month to month',
    body: [
      'IRPEF is a yearly tax: each month your employer withholds a twelfth of what it expects for the year, less your deductions for work and for family members. In December (or in February, for some employers) it does the conguaglio: it recomputes the tax on the real yearly income, and the difference comes back to you or is taken that month.',
      'The regional and municipal surcharges (addizionali) are owed on the year before: they are withheld from January to November of the following year, so a new job can show surcharges of an income earned elsewhere.',
    ],
  },
  {
    id: 'counters',
    title: 'The counters: holidays, ROL and the 13th',
    body: [
      'The bottom of the payslip keeps your counters: holidays (ferie), reduced working hours (ROL) and leaves (permessi), each as accrued, taken and left. Hours left at the end of the year carry over, but holidays have to be taken within 18 months of the year they accrue in.',
      'The 13th month (tredicesima, in December) and, in some contracts such as commerce, the 14th (quattordicesima, in June or July) accrue a twelfth every month you work. Leave the job mid-year and the accrued share is paid with the last payslip.',
    ],
  },
  {
    id: 'check',
    title: 'What is worth checking',
    body: [
      'The figures that matter can be compared month by month, and the Payslips section does it for you: the base pay against your contract, the hours worked and paid, the overtime, the tax and the net. A change with no reason (a pay rise not applied, a step missing, an allowance gone) is worth asking the payroll office about while the month is recent.',
    ],
  },
];

export const TFR_GUIDE: WorkGuideSection[] = [
  {
    id: 'what',
    title: 'What the TFR is',
    body: [
      'The TFR (trattamento di fine rapporto) is severance pay: every year your employer sets aside about one month of your pay (the yearly gross divided by 13.5), and pays it all to you when the job ends, whatever the reason.',
      'If you joined a pension fund, the TFR goes there each month instead. In a company with 50 employees or more, the TFR you leave with the company is held by INPS (Fondo di Tesoreria), but your employer is still the one who pays it.',
    ],
  },
  {
    id: 'growth',
    title: 'How it grows',
    body: [
      'Each 31 December, the TFR set aside until the year before is revalued by 1.5% plus three quarters of the inflation measured by ISTAT. The revaluation is taxed at 17% the same year, so it reaches you already taxed.',
    ],
  },
  {
    id: 'advance',
    title: 'Taking part of it early',
    body: [
      'After 8 years with the same employer you can ask for up to 70% of the TFR in advance, once, for medical expenses, to buy or build your first home (or your children’s), or during parental or training leave. Employers can grant more under a company agreement.',
    ],
  },
  {
    id: 'tax',
    title: 'How it is taxed',
    body: [
      'The TFR is taxed apart from the rest of your income (tassazione separata), at the average rate of your last years: your employer withholds a first estimate when it pays, and the Agenzia delle Entrate recomputes it later and can send a small bill or a refund. In a pension fund, the TFR is taxed at 15%, less 0.3 points a year after the 15th of membership, down to 9%.',
      'The For later section compares, with your own figures, leaving the TFR with the company against sending it to a fund.',
    ],
  },
];

export const CU_GUIDE: WorkGuideSection[] = [
  {
    id: 'what',
    title: 'What the CU is',
    body: [
      'The Certificazione Unica (CU) is the yearly statement of what your employer paid you and withheld: the income of the year, the IRPEF and surcharges taken, the deductions applied, the TFR paid and the contributions. Your employer has to give it to you by 16 March of the following year, and sends the same figures to the Agenzia delle Entrate for your pre-filled 730.',
    ],
  },
  {
    id: 'lines',
    title: 'The lines that matter',
    points: [
      'Point 1: the income from employment of the year, the sum of the taxable pay of every payslip.',
      'Point 21: the IRPEF withheld, after the conguaglio.',
      'Points 22 and 26 to 27: the regional and municipal surcharges withheld.',
      'Your days of work (point 6) and the family members you claimed, which set your deductions.',
    ],
    body: [],
  },
  {
    id: 'differs',
    title: 'When it differs from your payslips',
    body: [
      'Life Island adds up the payslips of the year and compares the sum with the CU. A difference usually means a payslip that is missing here (load it and the gap closes), a payslip paid in January for December (it counts in the year it is paid), or a correction your employer made after the last payslip. If the gap stays, ask the payroll office before you file the 730: a CU can be corrected and sent again.',
    ],
  },
];

export const REVIEWS_GUIDE: WorkGuideSection[] = [
  {
    id: 'rules',
    title: 'How your marks work',
    body: [
      'Your employer’s evaluation rules (the incentive plan, sistema incentivante or scheda obiettivi) say what each section is worth, what a mark means and how the score converts to a bonus. Load them in the documents app and approve them under your workplace: every evaluation is then read against the version in force on its date.',
      'When the company publishes a new version, load it too: it takes over from the day it applies, and older evaluations keep the rules of their time.',
    ],
  },
  {
    id: 'use',
    title: 'Getting the most from a review',
    body: [
      'A review is the one meeting where your pay and your next step are on the table. Bring the figures Life Island keeps for you: your marks over the years, how your pay moved against inflation, and what the market pays for your role.',
    ],
    points: [
      'Ask what the next mark needs, in concrete goals, and write them down.',
      'Ask when your pay is reviewed, and what a rise depends on.',
      'Load the evaluation afterwards, so the next one has something to compare with.',
    ],
  },
];
