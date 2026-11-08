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

/** The work document types: PAYSLIP (migration 0007) and the two of migration 0014. */
export const WORK_DOCUMENT_TYPES = [
  'PAYSLIP',
  'PERFORMANCE_REVIEW',
  'EMPLOYMENT_CONTRACT',
] as const;
export type WorkDocumentType = (typeof WORK_DOCUMENT_TYPES)[number];

/** The subject category of every work document; one filed only under it has no specific type. */
export const WORK_DOCUMENT_ROOT = 'WORK';

export const WORK_DOCUMENT_TYPE_LABELS: Record<WorkDocumentType, string> = {
  PAYSLIP: 'Payslip',
  PERFORMANCE_REVIEW: 'Evaluation',
  EMPLOYMENT_CONTRACT: 'Employment contract',
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
  years: YearStatsDto[];
  monthly: MonthPointDto[];
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

export interface WorkOverviewDto {
  workplaces: WorkplaceDto[];
  reviews: PendingWorkReviewDto[];
  rejected: RejectedCareerDocumentDto[];
  /** Newest first. */
  timeline: CareerEventDto[];
  stats: CareerStatsDto;
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
