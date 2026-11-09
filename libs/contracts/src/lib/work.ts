import { z } from 'zod';

/*
 * The Work area (svc-work, mfe-work): every workplace you have had (the
 * employer, the work site and your employment there), read from payslips,
 * evaluations and employment contracts. A new document never changes a
 * workplace on its own: it suggests the values it prints and you take them.
 * From what you approved come a timeline of notable events (hiring,
 * promotions, rises, evaluations), your pay statistics and an AI feedback on
 * your career. Next to them, the hiring platforms you signed up to.
 * The JSON model these follow is life-island-docs (entities/organization,
 * entities/employment, entities/workplace and payslips/payslip.schema.json).
 */

/**
 * The work document types: PAYSLIP (migration 0007), the two of migration
 * 0014, EVALUATION_RULES (0018), the rules an employer scores its
 * evaluations by, and CERTIFICAZIONE_UNICA (0019), the yearly statement of
 * the income an employer paid you and the taxes it withheld.
 */
export const WORK_DOCUMENT_TYPES = [
  'PAYSLIP',
  'PERFORMANCE_REVIEW',
  'EMPLOYMENT_CONTRACT',
  'EVALUATION_RULES',
  'CERTIFICAZIONE_UNICA',
] as const;
export type WorkDocumentType = (typeof WORK_DOCUMENT_TYPES)[number];

/** The subject category of every work document; one filed only under it has no specific type. */
export const WORK_DOCUMENT_ROOT = 'WORK';

export const WORK_DOCUMENT_TYPE_LABELS: Record<WorkDocumentType, string> = {
  PAYSLIP: 'Payslip',
  PERFORMANCE_REVIEW: 'Evaluation',
  EMPLOYMENT_CONTRACT: 'Employment contract',
  EVALUATION_RULES: 'Evaluation rules',
  CERTIFICAZIONE_UNICA: 'Certificazione Unica',
};

export const CONTRACT_KINDS = [
  'permanent',
  'fixed_term',
  'apprenticeship',
  'internship',
  'freelance',
  'agency',
  'other',
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  permanent: 'Permanent (tempo indeterminato)',
  fixed_term: 'Fixed term (tempo determinato)',
  apprenticeship: 'Apprenticeship',
  internship: 'Internship (tirocinio)',
  freelance: 'Freelance',
  agency: 'Agency (somministrazione)',
  other: 'Other',
};

export type WorkplaceFieldType =
  'string' | 'date' | 'amount' | 'number' | 'integer' | 'enum';
export type WorkplaceFieldGroup = 'employer' | 'employment' | 'pay';

export interface WorkplaceFieldDefinition {
  /** Name in the JSON model (camelCase). */
  field: string;
  /** Key of the category template that prints it. */
  key: string;
  label: string;
  type: WorkplaceFieldType;
  group: WorkplaceFieldGroup;
  /** Values that should never change for one employment: a different one is to check. */
  stable: boolean;
  description: string;
  options?: readonly string[];
}

/**
 * What Life Island keeps of a workplace: the employer, its work site and your
 * employment there, under the names of life-island-docs/entities. Values that
 * change month by month (level, CCNL, pay) hold the latest you approved; each
 * document keeps its own.
 */
export const WORKPLACE_FIELD_DEFINITIONS = [
  {
    field: 'employerName',
    key: 'employer',
    label: 'Employer',
    type: 'string',
    group: 'employer',
    stable: false,
    description: 'Company that pays the salary, as printed',
  },
  {
    field: 'employerTaxCode',
    key: 'employer_tax_code',
    label: 'Employer tax code',
    type: 'string',
    group: 'employer',
    stable: true,
    description: 'Codice fiscale or partita IVA of the employer (C.F. / P.IVA)',
  },
  {
    field: 'employerAddress',
    key: 'employer_address',
    label: 'Registered office',
    type: 'string',
    group: 'employer',
    stable: false,
    description: 'Address of the employer, as printed in its header',
  },
  {
    field: 'workplaceAddress',
    key: 'workplace_address',
    label: 'Work site',
    type: 'string',
    group: 'employer',
    stable: false,
    description: 'Sede di lavoro: where you work, as printed',
  },
  {
    field: 'employeeCode',
    key: 'employee_code',
    label: 'Employee code',
    type: 'string',
    group: 'employment',
    stable: true,
    description: 'Your number at the employer (COD.DIP., matricola)',
  },
  {
    field: 'hireDate',
    key: 'hire_date',
    label: 'Hired on',
    type: 'date',
    group: 'employment',
    stable: true,
    description: 'Data di assunzione',
  },
  {
    field: 'endDate',
    key: 'end_date',
    label: 'Ends on',
    type: 'date',
    group: 'employment',
    stable: false,
    description:
      'Scadenza del contratto or fine rapporto, only when printed (fixed-term contracts, a last payslip)',
  },
  {
    field: 'contractKind',
    key: 'contract_kind',
    label: 'Contract',
    type: 'enum',
    group: 'employment',
    stable: false,
    description:
      'permanent (tempo indeterminato), fixed_term, apprenticeship, internship, freelance, agency or other',
    options: CONTRACT_KINDS,
  },
  {
    field: 'collectiveAgreement',
    key: 'contract_type',
    label: 'Collective agreement',
    type: 'string',
    group: 'employment',
    stable: false,
    description: 'Collective agreement (CCNL), as printed',
  },
  {
    field: 'qualification',
    key: 'qualification',
    label: 'Qualification',
    type: 'string',
    group: 'employment',
    stable: false,
    description: 'Descrizione qualifica: impiegato, quadro, operaio...',
  },
  {
    field: 'level',
    key: 'job_level',
    label: 'Level',
    type: 'string',
    group: 'employment',
    stable: false,
    description: 'Livello or grade (B1, 5S, Quadro)',
  },
  {
    field: 'jobTitle',
    key: 'job_title',
    label: 'Job title',
    type: 'string',
    group: 'employment',
    stable: false,
    description: 'Mansione or role, as printed',
  },
  {
    field: 'costCenter',
    key: 'cost_center',
    label: 'Cost center / team',
    type: 'string',
    group: 'employment',
    stable: false,
    description: 'Centro di costo with its code, as printed',
  },
  {
    field: 'partTimePercentage',
    key: 'part_time_percentage',
    label: 'Part time',
    type: 'number',
    group: 'employment',
    stable: false,
    description: '% part time, only when printed',
  },
  {
    field: 'weeklyHours',
    key: 'weekly_hours',
    label: 'Weekly hours',
    type: 'number',
    group: 'employment',
    stable: false,
    description: 'Contract hours per week',
  },
  {
    field: 'monthlySalary',
    key: 'monthly_salary',
    label: 'Monthly salary (gross)',
    type: 'amount',
    group: 'pay',
    stable: false,
    description:
      'Retribuzione mensile: the full monthly gross pay of the contract, before one-off items',
  },
  {
    field: 'baseMinimum',
    key: 'base_minimum',
    label: 'CCNL minimum',
    type: 'amount',
    group: 'pay',
    stable: false,
    description: 'Minimo contrattuale (paga base)',
  },
  {
    field: 'superminimum',
    key: 'superminimum',
    label: 'Superminimum',
    type: 'amount',
    group: 'pay',
    stable: false,
    description: 'Superminimo (assorbibile or not), when printed',
  },
  {
    field: 'seniorityIncrements',
    key: 'seniority_increments',
    label: 'Seniority increments',
    type: 'integer',
    group: 'pay',
    stable: false,
    description: 'Number of scatti di anzianità matured',
  },
  {
    field: 'annualGrossSalary',
    key: 'annual_gross_salary',
    label: 'Annual gross (RAL)',
    type: 'amount',
    group: 'pay',
    stable: false,
    description:
      'Retribuzione annua lorda, as stated by a contract or evaluation',
  },
] as const satisfies readonly WorkplaceFieldDefinition[];

export type WorkplaceField =
  (typeof WORKPLACE_FIELD_DEFINITIONS)[number]['field'];
export const WORKPLACE_FIELDS = WORKPLACE_FIELD_DEFINITIONS.map(
  (d) => d.field,
) as readonly WorkplaceField[];

export type WorkplaceValue = string | number | null;
export type WorkplaceValues = Record<WorkplaceField, WorkplaceValue>;

/** Template keys a payslip prints besides the workplace's values. */
export const PAYSLIP_KEYS = {
  period: 'pay_period',
  gross: 'gross_pay',
  deductions: 'total_deductions',
  net: 'net_pay',
  taxable: 'taxable_income',
  incomeTax: 'income_tax_withheld',
  contributions: 'social_security_contributions',
  hoursWorked: 'hours_worked',
  vacationLeft: 'vacation_left',
  leaveLeft: 'leave_left',
  severance: 'severance_accrued',
  welfare: 'welfare_credits',
  kind: 'payslip_kind',
} as const;

/**
 * What a payslip pays: the month (regular), or only an extra month paid on
 * its own payslip, in the same month as a regular one: the tredicesima
 * (thirteenth), the quattordicesima (fourteenth), or a bonus, arrears or
 * settlement (other). One that does not say is regular.
 */
export const PAYSLIP_KINDS = [
  'regular',
  'thirteenth',
  'fourteenth',
  'other',
] as const;
export type PayslipKind = (typeof PAYSLIP_KINDS)[number];
export const PAYSLIP_KIND_LABELS: Record<PayslipKind, string> = {
  regular: 'Monthly payslip',
  thirteenth: 'Tredicesima (13th month)',
  fourteenth: 'Quattordicesima (14th month)',
  other: 'Extra payslip',
};

/**
 * Template keys of a Certificazione Unica (CERTIFICAZIONE_UNICA, migration
 * 0019), read by Work and by the 730. The points are the CU 2025 layout.
 */
export const TAX_CERTIFICATE_KEYS = {
  employer: 'employer',
  employerTaxCode: 'employer_tax_code',
  /** The year the income is about, not the year in the form's name. */
  incomeYear: 'income_year',
  issueDate: 'issue_date',
  /** Punti 1 + 2. */
  employmentIncome: 'employment_income',
  pensionIncome: 'pension_income',
  /** Punto 6. */
  days: 'days_worked',
  /** Punto 21. */
  irpefWithheld: 'irpef_withheld',
  /** Punto 22. */
  regionalSurtax: 'regional_surtax',
  /** Punti 26 + 27. */
  municipalSurtax: 'municipal_surtax',
  /** Punto 361. */
  grossTax: 'gross_tax',
  /** Punti 367 + 368. */
  workDeductions: 'work_deductions',
  /** Punto 362. */
  familyDeductions: 'family_deductions',
  /** Punto 374. */
  totalDeductions: 'total_deductions',
  /** Punto 375. */
  netTax: 'net_tax',
  /** Punto 391. */
  integrativeTreatment: 'integrative_treatment',
  /** Punto 431. */
  deductibleByEmployer: 'deductible_expenses_by_employer',
  /** Punto 441. */
  healthFund: 'health_fund_contributions',
  /** Punto 571. */
  productivityBonus: 'productivity_bonus',
  /** Punto 576. */
  productivityBonusTax: 'productivity_bonus_tax',
  severance: 'severance',
} as const;

export const WORKPLACE_STATUSES = ['current', 'past'] as const;
export type WorkplaceStatus = (typeof WORKPLACE_STATUSES)[number];
export const WORKPLACE_STATUS_LABELS: Record<WorkplaceStatus, string> = {
  current: 'Where you work',
  past: 'Past',
};

/** Notable events of a career: read from documents, or added by you. */
export const CAREER_EVENT_KINDS = [
  'hired',
  'left',
  'promotion',
  'level_change',
  'salary_rise',
  'salary_cut',
  'role_change',
  'contract_change',
  'seniority_increment',
  'extra_pay',
  'evaluation',
  'contract_signed',
  'award',
  'course',
  'certification',
  'project',
  'note',
] as const;
export type CareerEventKind = (typeof CAREER_EVENT_KINDS)[number];

/** The kinds you can add by hand (the others are also read from documents). */
export const MANUAL_CAREER_EVENT_KINDS = [
  'promotion',
  'salary_rise',
  'role_change',
  'evaluation',
  'award',
  'course',
  'certification',
  'project',
  'note',
] as const satisfies readonly CareerEventKind[];

export const CAREER_EVENT_LABELS: Record<CareerEventKind, string> = {
  hired: 'Hired',
  left: 'Left',
  promotion: 'Promotion',
  level_change: 'Level change',
  salary_rise: 'Salary rise',
  salary_cut: 'Lower salary',
  role_change: 'New role',
  contract_change: 'New collective agreement',
  seniority_increment: 'Seniority increment',
  extra_pay: 'Extra pay',
  evaluation: 'Evaluation',
  contract_signed: 'Contract signed',
  award: 'Award',
  course: 'Course',
  certification: 'Certification',
  project: 'Project',
  note: 'Note',
};

/** The events the timeline highlights. */
export const NOTABLE_CAREER_EVENTS: readonly CareerEventKind[] = [
  'hired',
  'left',
  'promotion',
  'salary_rise',
  'role_change',
  'award',
  'certification',
];

export interface WorkFactDto {
  label: string;
  value: string;
}

export type WorkplaceChangeKind = 'new_value' | 'different_value';
export type WorkplaceChangeSuggestion = 'accept' | 'keep_current' | 'check';

export interface WorkplaceChangeDto {
  field: WorkplaceField;
  kind: WorkplaceChangeKind;
  current: WorkplaceValue;
  proposed: string | number;
  suggestion: WorkplaceChangeSuggestion;
}

export type WorkplaceMatch = 'tax_code' | 'name' | 'none';

/** One approved document of a workplace. */
export interface CareerDocumentDto {
  uploadId: string;
  title: string;
  type: WorkDocumentType | null;
  /** The month paid (YYYY-MM) for a payslip, else the document's date (YYYY-MM-DD). */
  period: string | null;
  gross: number | null;
  net: number | null;
  facts: WorkFactDto[];
  uploadedAt: string;
  reviewedAt: string;
}

export interface WorkplaceDto {
  id: string;
  label: string | null;
  status: WorkplaceStatus;
  values: WorkplaceValues;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Approved documents, newest first. */
  documents: CareerDocumentDto[];
  /** From the hire date (else the first payslip) to the end date or today. */
  tenureMonths: number | null;
  /** The month of the latest payslip (YYYY-MM). */
  latestPeriod: string | null;
}

export interface PendingWorkReviewDto {
  uploadId: string;
  title: string;
  type: WorkDocumentType | null;
  uploadedAt: string;
  employerName: string | null;
  employerTaxCode: string | null;
  /** Period, amounts and ratings it prints. */
  facts: WorkFactDto[];
  /** Every workplace value it prints. */
  printed: { field: WorkplaceField; value: string | number }[];
  /** The workplace it was matched to; null: none (a new workplace, when it names an employer). */
  workplaceId: string | null;
  match: WorkplaceMatch;
  /** Against the matched workplace (for a new one, every printed value). */
  changes: WorkplaceChangeDto[];
  /** Older than a document you already approved: suggests keeping your values. */
  outdated: boolean;
  /**
   * A document you already have for the same thing (a payslip of the same
   * workplace, month and kind; a CU of the same employer and year): likely a
   * copy, to reject. Approving it anyway does not count it twice.
   */
  alreadyHave: { uploadId: string; title: string; what: string } | null;
}

export interface RejectedCareerDocumentDto {
  uploadId: string;
  title: string;
  type: WorkDocumentType | null;
  decidedAt: string;
}

export interface CareerEventDto {
  id: string;
  /** YYYY-MM-DD; a payslip's event is on the first day of its month. */
  date: string;
  kind: CareerEventKind;
  title: string;
  detail: string | null;
  workplaceId: string | null;
  workplaceName: string | null;
  source: 'document' | 'manual';
  /** The document it was read from. */
  uploadId: string | null;
  /** A salary or extra pay, when the event is about money. */
  amount: number | null;
  /** Change from before, in percent (rises and cuts). */
  changePct: number | null;
  notable: boolean;
}

export interface YearStatsDto {
  year: number;
  payslips: number;
  gross: number;
  net: number;
  incomeTax: number;
  contributions: number;
  welfare: number;
  severance: number;
  averageNet: number;
  /** Gross of the payslips that pay only an extra month (tredicesima, quattordicesima, bonus). */
  extraPay: number;
}

/**
 * A Certificazione Unica you approved, next to the payslips of the same
 * workplace and year: a gap shows a payslip missing (or a conguaglio).
 */
export interface TaxCertificateDto {
  uploadId: string;
  title: string;
  workplaceId: string;
  workplaceName: string;
  /** The year the income is about. */
  year: number;
  /** Employment income (punti 1 + 2). */
  income: number | null;
  days: number | null;
  /** Ritenute IRPEF (punto 21). */
  irpefWithheld: number | null;
  /** Regional and municipal surtax (punti 22, 26 + 27). */
  surtaxes: number | null;
  grossTax: number | null;
  totalDeductions: number | null;
  netTax: number | null;
  /** The payslips of the same workplace and year (each counted once). */
  payslips: number;
  /** Months of the year without a monthly payslip (YYYY-MM). */
  missingMonths: string[];
  /** Taxable income of those payslips, or their gross when not all print it. */
  payslipIncome: number | null;
  payslipIncomeKind: 'taxable' | 'gross' | null;
  payslipIncomeTax: number | null;
  /** CU minus payslips; null when a side is missing (the income one also when the payslips give only gross). */
  incomeGap: number | null;
  taxGap: number | null;
}

export interface MonthPointDto {
  /** YYYY-MM */
  period: string;
  gross: number | null;
  net: number | null;
  monthlySalary: number | null;
  workplaceId: string;
}

export interface CareerStatsDto {
  payslips: number;
  currentEmployer: string | null;
  currentLevel: string | null;
  currentMonthlySalary: number | null;
  /** Months at the current workplace. */
  tenureMonths: number | null;
  /** Months of every workplace together. */
  careerMonths: number | null;
  /** From the first monthly salary you have to the latest, in percent. */
  salaryGrowthPct: number | null;
  /** The same growth per year (compound). */
  annualGrowthPct: number | null;
  /** Since the last salary rise or promotion, in months. */
  monthsSinceLastRise: number | null;
  /** Net over gross of the payslips of the last 12 months. */
  netRatio: number | null;
  vacationLeft: number | null;
  leaveLeft: number | null;
  /** The months with no payslip, between the first and the latest at the current workplace. */
  missingMonths: string[];
  /** Payslips whose figures are incomplete or clash with another of the same month. */
  checks: PayslipCheckDto[];
  years: YearStatsDto[];
  monthly: MonthPointDto[];
}

/**
 * Why a payslip you approved is not fully in the figures: its month, or
 * values the statistics need (gross, net, monthly salary), were not read; or
 * another payslip of the same month and kind with different amounts makes
 * one of them count only once.
 */
export interface PayslipCheckDto {
  uploadId: string;
  title: string;
  /** The month paid (YYYY-MM), when read. */
  period: string | null;
  kind: 'no_month' | 'missing_values' | 'same_month';
  /** Labels of the values not read, for missing_values. */
  missing: string[];
  message: string;
}

export const PLATFORM_STATUSES = ['active', 'paused', 'closed'] as const;
export type PlatformStatus = (typeof PLATFORM_STATUSES)[number];
export const PLATFORM_STATUS_LABELS: Record<PlatformStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  closed: 'Closed',
};

/** A profile counts as stale after this many days without an update. */
export const PLATFORM_STALE_DAYS = 180;

/** The main hiring platforms, offered when you add one. */
export const HIRING_PLATFORM_PRESETS = [
  { name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/' },
  { name: 'Indeed', url: 'https://it.indeed.com/' },
  { name: 'InfoJobs', url: 'https://www.infojobs.it/' },
  { name: 'Glassdoor', url: 'https://www.glassdoor.it/' },
  { name: 'Monster', url: 'https://www.monster.it/' },
  { name: 'Welcome to the Jungle', url: 'https://www.welcometothejungle.com/' },
  { name: 'Randstad', url: 'https://www.randstad.it/' },
  { name: 'Adecco', url: 'https://www.adecco.it/' },
] as const;

export interface HiringPlatformDto {
  id: string;
  name: string;
  url: string;
  /** The e-mail or username you signed up with. */
  account: string | null;
  status: PlatformStatus;
  /** When you last updated your profile or CV there (YYYY-MM-DD). */
  profileUpdatedAt: string | null;
  notes: string | null;
  createdAt: string;
  /** Active, and the profile was not updated in PLATFORM_STALE_DAYS (or never). */
  stale: boolean;
}

/** What an AI (or the offline rules) says about your career. */
export const careerFeedbackOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two to four sentences on where the career stands now'),
  strengths: z
    .array(z.string())
    .describe('What is going well, each backed by the data'),
  watchouts: z
    .array(z.string())
    .describe('Risks or things that look stalled, each backed by the data'),
  suggestions: z
    .array(
      z.object({
        title: z.string().describe('A short action, verb first'),
        detail: z.string().describe('Why, and how to do it'),
      }),
    )
    .describe('Three to six concrete next steps'),
});
export type CareerFeedbackOutput = z.infer<typeof careerFeedbackOutputSchema>;

export interface CareerFeedbackDto extends CareerFeedbackOutput {
  id: string;
  question: string | null;
  /** claude: written by the Claude API; offline: by Life Island's own rules, no key needed. */
  source: 'claude' | 'offline';
  model: string | null;
  /** Documents the feedback was based on. */
  documentsUsed: number;
  createdAt: string;
}

/** One score of an evaluation: a section or a single criterion. */
export interface ScoreItemDto {
  name: string;
  score: number;
  /** The highest score possible, when the form says it. */
  max: number | null;
}

/** One evaluation you approved, as Work reads it. */
export interface EvaluationDto {
  uploadId: string;
  title: string;
  workplaceId: string;
  workplaceName: string | null;
  /** When it counts: the evaluation's date, else the end of its period (YYYY-MM-DD). */
  date: string | null;
  /** The part of the year evaluated, as printed (1° quadrimestre 2026, H1, annual). */
  cycle: string | null;
  /** Its period, when printed (YYYY-MM-DD). */
  periodStart: string | null;
  periodEnd: string | null;
  role: string | null;
  team: string | null;
  reviewer: string | null;
  /** The total score of the period, and the highest possible when known. */
  score: number | null;
  maxScore: number | null;
  /** The score over the highest possible, 0 to 1, when the highest is known. */
  scoreShare: number | null;
  /** The overall judgement as printed, when it is not a number (Exceeds expectations, B). */
  rating: string | null;
  sections: ScoreItemDto[];
  criteria: ScoreItemDto[];
  /** Share of the bonus target the score converts to, in percent. */
  payoutPct: number | null;
  bonus: number | null;
  bonusTarget: number | null;
  /** Annual gross (RAL) the form states. */
  annualGross: number | null;
  /** Where the score sits in the conversion table of its employer's rules, when you have them. */
  band: EvaluationBandDto | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  comments: string | null;
}

/** One criterion across your evaluations (same criterion under slightly different names counts once). */
export interface CriterionTrendDto {
  name: string;
  /** Oldest first, one per evaluation that scores it. */
  points: { uploadId: string; date: string | null; score: number }[];
  max: number | null;
  first: number;
  latest: number;
  average: number;
  /** Latest minus first. */
  change: number;
}

export interface EvaluationYearDto {
  year: number;
  evaluations: number;
  averageScore: number | null;
  bestScore: number | null;
  /** Bonus paid by the evaluations of the year. */
  bonus: number;
  bonusTarget: number | null;
  /** The year's gross pay from your payslips, to set the bonus against. */
  payslipGross: number | null;
  /** Bonus over the year's payslip gross, in percent. */
  bonusShareOfGrossPct: number | null;
  role: string | null;
  annualGross: number | null;
}

/** Your evaluations in numbers. */
/** One step of a rules document's conversion table: from `min` points, `pct` of the bonus target. */
export interface ScoreBandDto {
  /** Lowest score of the band; null for the bottom one ("below 60"). */
  min: number | null;
  /** Highest score of the band, when printed. */
  max: number | null;
  pct: number;
}

/** A line of a rules document: a section and its highest score, or what a mark means. */
export interface RuleItemDto {
  name: string;
  /** The highest score of a section, or the mark a meaning is for. */
  value: number | null;
  /** How it is scored or what it means, as the rules say it. */
  note: string | null;
}

/**
 * The rules an employer scores its evaluations by (an incentive plan, a
 * scheda obiettivi): one document per version, filed under its workplace.
 * Every company has its own, so nothing here is fixed in code.
 */
export interface EvaluationRulesDto {
  uploadId: string;
  title: string;
  workplaceId: string;
  workplaceName: string | null;
  version: string | null;
  /** From when it applies (YYYY-MM-DD); else the document's date. */
  effectiveFrom: string | null;
  /** Highest total score of an evaluation. */
  maxScore: number | null;
  /** Highest share of the target the bonus can reach, in percent. */
  maxPayoutPct: number | null;
  /** How the yearly bonus target is set, as written (10% of the RAL). */
  targetRule: string | null;
  /** What each mark means, best last. */
  scale: RuleItemDto[];
  /** The parts of an evaluation and their highest score. */
  sections: RuleItemDto[];
  /** Score to bonus conversion, lowest first. */
  bands: ScoreBandDto[];
  /** When each period is evaluated and paid. */
  schedule: string[];
  /** Who it applies to and when it does not. */
  eligibility: string[];
  /** Anything else worth knowing to read the marks. */
  notes: string[];
}

/** Where an evaluation's score sits in its rules' conversion table. */
export interface EvaluationBandDto {
  rulesUploadId: string;
  /** Share of the target this score converts to, by the rules. */
  pct: number;
  /** The score the next band starts at, and its share; null at the top. */
  nextAt: number | null;
  nextPct: number | null;
  /** Points to the next band. */
  pointsToNext: number | null;
  /** Points over the start of this band: how close to dropping one. */
  marginBelow: number | null;
}

export interface EvaluationStatsDto {
  count: number;
  /** Oldest first. */
  evaluations: EvaluationDto[];
  latest: EvaluationDto | null;
  /** Latest total score minus the one before. */
  scoreChange: number | null;
  averageScore: number | null;
  bestScore: number | null;
  /** Average payout over the evaluations that state one, in percent. */
  averagePayoutPct: number | null;
  bonusTotal: number;
  /** Best criteria first (by average share of their max, else average). */
  criteria: CriterionTrendDto[];
  /** Your strongest and weakest criteria, by average. */
  strongest: string[];
  weakest: string[];
  /** Criteria that improved or dropped the most between first and latest. */
  improving: string[];
  declining: string[];
  /** Each role and team as the evaluations state them, oldest first. */
  roles: {
    role: string | null;
    team: string | null;
    from: string | null;
    to: string | null;
  }[];
  years: EvaluationYearDto[];
  /** The evaluation rules of each workplace, newest version first. */
  rules: EvaluationRulesDto[];
}

export interface WorkOverviewDto {
  workplaces: WorkplaceDto[];
  reviews: PendingWorkReviewDto[];
  rejected: RejectedCareerDocumentDto[];
  /** Newest first. */
  timeline: CareerEventDto[];
  stats: CareerStatsDto;
  /** Your evaluations: scores, criteria, bonus and roles. */
  evaluations: EvaluationStatsDto;
  /** Your Certificazioni Uniche, newest year first. */
  certificates: TaxCertificateDto[];
  platforms: HiringPlatformDto[];
  /** Newest first. */
  feedback: CareerFeedbackDto[];
  /** Whether the feedback is written by the Claude API (ANTHROPIC_API_KEY is set). */
  aiFeedback: boolean;
}

/** Whether a document names an employer, so it can make a new workplace. */
export function identifiesWorkplace(document: {
  employerName: string | null;
  employerTaxCode: string | null;
}): boolean {
  return Boolean(document.employerName || document.employerTaxCode);
}

const workplaceValue = z.union([
  z.string().trim().max(300),
  z.number(),
  z.null(),
]);

const fieldEnum = z.enum(
  WORKPLACE_FIELDS as [WorkplaceField, ...WorkplaceField[]],
);

export const approveWorkReviewRequestSchema = z.object({
  /** The workplace it is about; null adds a new one from it. */
  workplaceId: z.uuid().nullable(),
  /** The fields whose printed value you take; the others keep the workplace's value. */
  accept: z.array(fieldEnum).default([]),
  /** For a new workplace: how you call it. */
  label: z.string().trim().max(60).nullable().optional(),
});
export type ApproveWorkReviewRequest = z.input<
  typeof approveWorkReviewRequestSchema
>;

export const createWorkplaceRequestSchema = z.object({
  employerName: z.string().trim().min(1).max(200),
  label: z.string().trim().max(60).nullable().optional(),
  status: z.enum(WORKPLACE_STATUSES).optional(),
});
export type CreateWorkplaceRequest = z.input<
  typeof createWorkplaceRequestSchema
>;

export const updateWorkplaceRequestSchema = z.object({
  label: z.string().trim().max(60).nullable().optional(),
  status: z.enum(WORKPLACE_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  values: z.partialRecord(fieldEnum, workplaceValue).optional(),
});
export type UpdateWorkplaceRequest = z.input<
  typeof updateWorkplaceRequestSchema
>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const careerEventRequestSchema = z.object({
  date: isoDate,
  kind: z.enum(MANUAL_CAREER_EVENT_KINDS),
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(1000).nullable().optional(),
  workplaceId: z.uuid().nullable().optional(),
  amount: z.number().nullable().optional(),
});
export type CareerEventRequest = z.input<typeof careerEventRequestSchema>;

export const hiringPlatformRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((url) => /^https?:\/\/[^\s]+$/i.test(url), {
      message: 'Use a web address starting with https://',
    }),
  account: z.string().trim().max(200).nullable().optional(),
  status: z.enum(PLATFORM_STATUSES).optional(),
  profileUpdatedAt: isoDate.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type HiringPlatformRequest = z.input<typeof hiringPlatformRequestSchema>;

export const careerFeedbackRequestSchema = z.object({
  /** What you want to know; empty asks for a general feedback. */
  question: z.string().trim().max(1000).nullable().optional(),
});
export type CareerFeedbackRequest = z.input<typeof careerFeedbackRequestSchema>;
