import { z } from 'zod';
import { RENEWAL_WARNING_DAYS, type RenewableKind } from './cars.js';
import { EXPIRY_WARNING_DAYS, type IdDocumentType } from './people.js';
import {
  STUDY_IDLE_DAYS_SETTING,
  STUDY_REMINDER_DEFAULTS,
  STUDY_WEEKLY_GOAL_SETTING,
  studyReminderSettingKey,
} from './studies.js';
import { AGENDA_CALENDAR_SETTING } from './agenda.js';
import {
  FITNESS_WEEKLY_MINUTES_DEFAULT,
  FITNESS_WEEKLY_MINUTES_SETTING,
} from './fitness.js';
import {
  SUBSCRIPTIONS_WARN_DAYS_DEFAULT,
  SUBSCRIPTIONS_WARN_DAYS_SETTING,
} from './subscriptions.js';

/*
 * Settings (svc-settings, mfe-settings): every setting of the platform in one
 * place, and every tool that calls an AI model, grouped by module, with what
 * one use costs and a switch to turn it off.
 *
 * Two registries live here, in the shared contracts, so the service that runs
 * a tool, the Settings module that lists it and the page that shows it next to
 * the tool all read the same definition:
 * - AI_TOOLS: one entry per AI tool. A new AI tool is added here first
 *   (docs/guides/ai-tools.md is the full pattern).
 * - APP_SETTINGS: one entry per setting you can change at runtime.
 *
 * svc-settings owns the values and publishes `settings.changed@1`; each
 * service keeps its own replica (`settings_replica`, libs/be-common) and never
 * calls svc-settings to decide whether a tool may run.
 */

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Claude API list prices, USD per million tokens (checked 2026-11-10). */
export interface ModelPrice {
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Writing a 5-minute cache entry: 1.25× the input price. */
  cacheWrite: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-5-5': {
    label: 'Claude Haiku 5.5',
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  },
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5',
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite: 2.5,
  },
  'claude-opus-5-5': {
    label: 'Claude Opus 5.5',
    input: 4,
    output: 20,
    cacheRead: 0.2,
    cacheWrite: 5,
  },
};

/** The web search server tool: USD 10 per 1,000 searches, on top of tokens. */
export const WEB_SEARCH_PRICE_USD = 0.01;

/** The price of a model id; an unknown id is priced like Sonnet, so an estimate never reads as free. */
export function priceOf(model: string): ModelPrice & { known: boolean } {
  const exact = MODEL_PRICES[model];
  if (exact) return { ...exact, known: true };
  // A dated or suffixed id (`claude-haiku-5-5-fast`) still finds its family.
  const family = Object.keys(MODEL_PRICES).find((id) => model.startsWith(id));
  return family
    ? { ...MODEL_PRICES[family], known: true }
    : { ...MODEL_PRICES['claude-sonnet-5-5'], label: model, known: false };
}

// ---------------------------------------------------------------------------
// The AI tools registry
// ---------------------------------------------------------------------------

/** The modules that own AI tools, in the order Settings lists them. */
export const AI_TOOL_MODULES = [
  {
    id: 'documents',
    name: 'Documents',
    emblem: '🦅',
    character: 'ptera',
    service: 'svc-parse-worker',
  },
  {
    id: 'work',
    name: 'Work',
    emblem: '💼',
    character: 'pachy',
    service: 'svc-work',
  },
  {
    id: 'cars',
    name: 'Cars',
    emblem: '🚗',
    character: 'velo',
    service: 'svc-cars',
  },
  {
    id: 'studies',
    name: 'Studies',
    emblem: '📚',
    character: 'iggy',
    service: 'svc-studies',
  },
  {
    id: 'agenda',
    name: 'Agenda',
    emblem: '🗓️',
    character: 'compy',
    service: 'svc-agenda',
  },
  {
    id: 'money',
    name: 'Money',
    emblem: '💶',
    character: 'spino',
    service: 'svc-money',
  },
  {
    id: 'goals',
    name: 'Goals & habits',
    emblem: '🎯',
    character: 'rex',
    service: 'svc-goals',
  },
  {
    id: 'health',
    name: 'Health',
    emblem: '🩺',
    character: 'maia',
    service: 'svc-health',
  },
  {
    id: 'groceries',
    name: 'Groceries',
    emblem: '🦕',
    character: 'trice',
    service: 'svc-groceries',
  },
  {
    id: 'subscriptions',
    name: 'Contracts & subscriptions',
    emblem: '📑',
    character: 'allo',
    service: 'svc-subscriptions',
  },
  {
    id: 'mailbox',
    name: 'Admin mailbox',
    emblem: '📬',
    character: 'diplo',
    service: 'svc-mailbox',
  },
  {
    id: 'travel',
    name: 'Travel',
    emblem: '✈️',
    character: 'quetzal',
    service: 'svc-travel',
  },
  {
    id: 'fitness',
    name: 'Fitness',
    emblem: '🏃',
    character: 'galli',
    service: 'svc-fitness',
  },
] as const;
export type AiToolModuleId = (typeof AI_TOOL_MODULES)[number]['id'];

export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** One request a tool sends to the model; a tool can chain several. */
export interface AiToolStep {
  id: string;
  label: string;
  /** The env variable that picks the model, and its default. */
  modelEnv: string;
  defaultModel: string;
  effort: AiEffort;
  maxTokens: number;
  /** Server tools the request may use, e.g. `web_search`. */
  tools: readonly string[];
  /**
   * What one typical request uses, for the price shown before any real run.
   * Output includes thinking, which is billed as output.
   */
  estimate: { inputTokens: number; outputTokens: number; webSearches?: number };
  /** False for a step that runs only sometimes (a correction round, a long document). */
  always: boolean;
}

export interface AiToolDefinition {
  /** `<module>.<tool>`, stable: it keys the switch, the request and the uses. */
  id: string;
  module: AiToolModuleId;
  name: string;
  description: string;
  /** What one use is, for "per use" ("per document", "per question"). */
  unit: string;
  /** How the tool starts. */
  trigger: 'on-demand' | 'per-document' | 'scheduled';
  /** Where it lives in the apps: shown in Settings, with a link. */
  where: {
    app: 'documents' | 'island';
    path: string;
    label: string;
  };
  /** What happens while the tool is off, in one sentence. */
  whenOff: string;
  /** Switched on unless you turn it off. */
  defaultEnabled: boolean;
  steps: readonly AiToolStep[];
}

/**
 * Every tool of the platform that calls an AI model. Adding an AI tool starts
 * here; `settings.spec.ts` fails a definition without estimates or with a
 * duplicate id.
 */
export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    id: 'documents.classify',
    module: 'documents',
    name: 'Recognise documents',
    description:
      'Reads each document you load and decides what it is: type, purpose, the categories it belongs to and which area of the island uses its data.',
    unit: 'document',
    trigger: 'per-document',
    where: {
      app: 'documents',
      path: '/review',
      label: 'Documents · AI processing',
    },
    whenOff:
      "Documents are recognised by Life Island's own rules (file name, title and a few known layouts), which are much less precise.",
    defaultEnabled: true,
    steps: [
      {
        id: 'classify',
        label: 'Classify',
        modelEnv: 'PARSE_CLASSIFY_MODEL',
        defaultModel: 'claude-haiku-5-5',
        effort: 'low',
        maxTokens: 4000,
        tools: [],
        estimate: { inputTokens: 6000, outputTokens: 1200 },
        always: true,
      },
    ],
  },
  {
    id: 'documents.discover',
    module: 'documents',
    name: 'Suggest new categories',
    description:
      'Looks for categories the archive does not have yet (an issuer, a house, a person) and suggests them, with the fields to read from documents like this one.',
    unit: 'document',
    trigger: 'per-document',
    where: {
      app: 'documents',
      path: '/categories',
      label: 'Documents · Categories',
    },
    whenOff:
      'No new categories are suggested; documents only get the categories you already have.',
    defaultEnabled: true,
    steps: [
      {
        id: 'discover',
        label: 'Discover categories',
        modelEnv: 'PARSE_DISCOVER_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'high',
        maxTokens: 16000,
        tools: [],
        estimate: { inputTokens: 8000, outputTokens: 2500 },
        always: true,
      },
    ],
  },
  {
    id: 'documents.extract',
    module: 'documents',
    name: 'Read the data',
    description:
      'Reads every field of the document (amounts, dates, people, codes) into the form you review, with one correction round when a value breaks its rules.',
    unit: 'document',
    trigger: 'per-document',
    where: { app: 'documents', path: '/review', label: 'Documents · Review' },
    whenOff:
      "Fields are read by Life Island's own readers, which know only a few layouts (payslips, some bills); the rest stays empty for you to fill in.",
    defaultEnabled: true,
    steps: [
      {
        id: 'extract',
        label: 'Extract',
        modelEnv: 'PARSE_EXTRACT_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'high',
        maxTokens: 16000,
        tools: [],
        estimate: { inputTokens: 8000, outputTokens: 3000 },
        always: true,
      },
      {
        id: 'correct',
        label: 'Correct (only when a value breaks its rules)',
        modelEnv: 'PARSE_EXTRACT_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'high',
        maxTokens: 16000,
        tools: [],
        estimate: { inputTokens: 11000, outputTokens: 3000 },
        always: false,
      },
    ],
  },
  {
    id: 'documents.transactions',
    module: 'documents',
    name: 'Match invoices and payments',
    description:
      'Reads the money facts of invoices, receipts and bank transfers (amount, date, payer, reference) so a payment can be linked to the invoice it settles.',
    unit: 'document',
    trigger: 'per-document',
    where: { app: 'documents', path: '/review', label: 'Documents · Review' },
    whenOff:
      "Money facts are read by Life Island's own rules, so fewer payments are matched.",
    defaultEnabled: true,
    steps: [
      {
        id: 'transaction',
        label: 'Read money facts',
        modelEnv: 'PARSE_CLASSIFY_MODEL',
        defaultModel: 'claude-haiku-5-5',
        effort: 'low',
        maxTokens: 3000,
        tools: [],
        estimate: { inputTokens: 4000, outputTokens: 600 },
        always: true,
      },
    ],
  },
  {
    id: 'documents.reclassify',
    module: 'documents',
    name: 'Re-label older documents',
    description:
      'When new categories are added, checks the documents read before them and adds the new categories that apply.',
    unit: 'document checked',
    trigger: 'scheduled',
    where: {
      app: 'documents',
      path: '/categories',
      label: 'Documents · Categories',
    },
    whenOff:
      "Older documents are re-labelled by Life Island's own rules (issuer and keywords) only.",
    defaultEnabled: true,
    steps: [
      {
        id: 'reclassify',
        label: 'Match new categories',
        modelEnv: 'RECLASSIFY_MODEL',
        defaultModel: 'claude-haiku-5-5',
        effort: 'low',
        maxTokens: 2000,
        tools: [],
        estimate: { inputTokens: 3000, outputTokens: 400 },
        always: true,
      },
    ],
  },
  {
    id: 'work.career-feedback',
    module: 'work',
    name: 'Career feedback',
    description:
      'A frank feedback on your career from your approved payslips, evaluations and contracts, an answer to your own question about it, or the talking points for a pay negotiation.',
    unit: 'feedback',
    trigger: 'on-demand',
    where: { app: 'island', path: '/work/feedback', label: 'Work · Feedback' },
    whenOff:
      "The feedback is written by Life Island's own rules from your pay statistics, with no AI.",
    defaultEnabled: true,
    steps: [
      {
        id: 'feedback',
        label: 'Write the feedback',
        modelEnv: 'WORK_FEEDBACK_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'medium',
        maxTokens: 16000,
        tools: [],
        estimate: { inputTokens: 7500, outputTokens: 4000 },
        always: true,
      },
    ],
  },
  {
    id: 'work.market-check',
    module: 'work',
    name: 'Market check',
    description:
      'Searches the web for public salary ranges for your role, level and city, then turns its notes into a comparison with your pay.',
    unit: 'check',
    trigger: 'on-demand',
    where: { app: 'island', path: '/work/tools', label: 'Work · Tools' },
    whenOff: 'The market check is not available; past checks stay visible.',
    defaultEnabled: true,
    steps: [
      {
        id: 'research',
        label: 'Search the web',
        modelEnv: 'WORK_FEEDBACK_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'medium',
        maxTokens: 16000,
        tools: ['web_search'],
        estimate: { inputTokens: 28000, outputTokens: 3000, webSearches: 5 },
        always: true,
      },
      {
        id: 'format',
        label: 'Structure the findings',
        modelEnv: 'WORK_FEEDBACK_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 8000,
        tools: [],
        estimate: { inputTokens: 4000, outputTokens: 1500 },
        always: true,
      },
    ],
  },
  {
    id: 'cars.insurance-quotes',
    module: 'cars',
    name: 'Insurance quote comparison',
    description:
      'Reads the insurance quotes you upload and sets them against your current policy (its record and, when on file, its policy document): price, bonus-malus class, every cover, excess, exclusions and what to ask before signing.',
    unit: 'comparison',
    trigger: 'on-demand',
    where: { app: 'island', path: '/cars', label: 'Cars · Insurance' },
    whenOff:
      'The comparison is not available; past comparisons stay visible, and the insurance history works without AI.',
    defaultEnabled: true,
    steps: [
      {
        id: 'compare',
        label: 'Compare the quotes',
        modelEnv: 'CARS_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'medium',
        maxTokens: 16000,
        tools: [],
        estimate: { inputTokens: 24000, outputTokens: 5000 },
        always: true,
      },
    ],
  },
  {
    id: 'studies.study-coach',
    module: 'studies',
    name: 'Study coach',
    description:
      'Plans your study week from the paths you follow, the steps in progress, the time you logged against your weekly goal, your courses and the exams ahead, or answers your own question about what to study.',
    unit: 'plan',
    trigger: 'on-demand',
    where: { app: 'island', path: '/studies', label: 'Studies · Coach' },
    whenOff:
      "The plan is written by Life Island's own rules: the next steps of the paths you follow, sized to your weekly goal.",
    defaultEnabled: true,
    steps: [
      {
        id: 'plan',
        label: 'Plan the week',
        modelEnv: 'STUDIES_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 8000,
        tools: [],
        estimate: { inputTokens: 5000, outputTokens: 2000 },
        always: true,
      },
    ],
  },
  {
    id: 'agenda.week-brief',
    module: 'agenda',
    name: 'Week brief',
    description:
      'Reads every date of the island for the next weeks (renewals, expiries, exams, trips, bills, your own items) and says what to do first, what can wait, and when.',
    unit: 'brief',
    trigger: 'on-demand',
    where: { app: 'island', path: '/agenda', label: 'Agenda · Week brief' },
    whenOff:
      "The brief is written by Life Island's own rules: the overdue dates first, then this week's, by date.",
    defaultEnabled: true,
    steps: [
      {
        id: 'brief',
        label: 'Write the brief',
        modelEnv: 'AGENDA_AI_MODEL',
        defaultModel: 'claude-haiku-5-5',
        effort: 'low',
        maxTokens: 6000,
        tools: [],
        estimate: { inputTokens: 5000, outputTokens: 1200 },
        always: true,
      },
    ],
  },
  {
    id: 'money.spending-review',
    module: 'money',
    name: 'Spending review',
    description:
      'Reads your last months of income and spending by category, your budgets and the charges that come back every month, and finds where you can save, what to watch and what is going well.',
    unit: 'review',
    trigger: 'on-demand',
    where: { app: 'island', path: '/money', label: 'Money · Review' },
    whenOff:
      "The review is written by Life Island's own rules: overspent budgets, categories above their average and recurring charges.",
    defaultEnabled: true,
    steps: [
      {
        id: 'review',
        label: 'Review the spending',
        modelEnv: 'MONEY_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 8000,
        tools: [],
        estimate: { inputTokens: 6000, outputTokens: 2000 },
        always: true,
      },
    ],
  },
  {
    id: 'goals.coach',
    module: 'goals',
    name: 'Goals coach',
    description:
      'Looks at your goals, their steps and dates, your habits and your weekly reviews, finds where you are stuck and why, and names one small next step for each.',
    unit: 'session',
    trigger: 'on-demand',
    where: { app: 'island', path: '/goals', label: 'Goals · Coach' },
    whenOff:
      "The advice is written by Life Island's own rules: goals with no step done for two weeks, overdue steps and habits below target.",
    defaultEnabled: true,
    steps: [
      {
        id: 'coach',
        label: 'Coach the week',
        modelEnv: 'GOALS_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'medium',
        maxTokens: 8000,
        tools: [],
        estimate: { inputTokens: 5000, outputTokens: 2000 },
        always: true,
      },
    ],
  },
  {
    id: 'health.results-explainer',
    module: 'health',
    name: 'Test results explainer',
    description:
      'Explains your test results in plain words: what each test measures, what the values and their trend suggest, and what to ask your doctor. It never gives a diagnosis.',
    unit: 'explanation',
    trigger: 'on-demand',
    where: { app: 'island', path: '/health', label: 'Health · Results' },
    whenOff:
      "The explanation is written by Life Island's own rules: which values are out of range and how they moved.",
    defaultEnabled: true,
    steps: [
      {
        id: 'explain',
        label: 'Explain the results',
        modelEnv: 'HEALTH_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 6000,
        tools: [],
        estimate: { inputTokens: 4000, outputTokens: 2500 },
        always: true,
      },
    ],
  },
  {
    id: 'groceries.shopping-list',
    module: 'groceries',
    name: 'Shopping list',
    description:
      'Suggests your next shopping list from what you usually buy and how often, and points out items whose price went up.',
    unit: 'list',
    trigger: 'on-demand',
    where: { app: 'island', path: '/groceries', label: 'Groceries · Shopping list' },
    whenOff:
      "The list is suggested by Life Island's own rules: the items you buy regularly that are due again.",
    defaultEnabled: true,
    steps: [
      {
        id: 'list',
        label: 'Suggest the list',
        modelEnv: 'GROCERIES_AI_MODEL',
        defaultModel: 'claude-haiku-5-5',
        effort: 'low',
        maxTokens: 4000,
        tools: [],
        estimate: { inputTokens: 6000, outputTokens: 1500 },
        always: true,
      },
    ],
  },
  {
    id: 'subscriptions.renewal-advisor',
    module: 'subscriptions',
    name: 'Renewal advisor',
    description:
      'Looks at each contract and subscription (cost, price changes, how much you use it, renewal and cancel-by dates) and says what to keep, renegotiate, switch or cancel, with what to tell the provider.',
    unit: 'review',
    trigger: 'on-demand',
    where: { app: 'island', path: '/subscriptions', label: 'Contracts · Advisor' },
    whenOff:
      "The advice comes from Life Island's own rules: what you rarely use, prices that went up and renewals coming soon.",
    defaultEnabled: true,
    steps: [
      {
        id: 'advise',
        label: 'Advise on renewals',
        modelEnv: 'SUBSCRIPTIONS_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 8000,
        tools: [],
        estimate: { inputTokens: 4000, outputTokens: 2500 },
        always: true,
      },
    ],
  },
  {
    id: 'mailbox.letter-explainer',
    module: 'mailbox',
    name: 'Letter explainer',
    description:
      'Reads an official letter you pasted (taxes, INPS, a fine, the bank, the condo) and explains it in plain words: what it asks, how much, by when, and the steps to take.',
    unit: 'letter',
    trigger: 'on-demand',
    where: { app: 'island', path: '/mailbox', label: 'Mailbox · Letters' },
    whenOff:
      "The letter is read by Life Island's own rules: its kind from keywords, and the first date and amount it prints.",
    defaultEnabled: true,
    steps: [
      {
        id: 'explain',
        label: 'Explain the letter',
        modelEnv: 'MAILBOX_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 6000,
        tools: [],
        estimate: { inputTokens: 5000, outputTokens: 1500 },
        always: true,
      },
    ],
  },
  {
    id: 'travel.trip-planner',
    module: 'travel',
    name: 'Trip planner',
    description:
      'Writes a checklist with dates, a packing list and a loose day-by-day plan for a trip, from its destination, dates, travellers, budget and bookings.',
    unit: 'plan',
    trigger: 'on-demand',
    where: { app: 'island', path: '/travel', label: 'Travel · Planner' },
    whenOff:
      "The checklist and packing list come from Life Island's own template, sized to the trip's length and whether it goes abroad.",
    defaultEnabled: true,
    steps: [
      {
        id: 'plan',
        label: 'Plan the trip',
        modelEnv: 'TRAVEL_AI_MODEL',
        defaultModel: 'claude-sonnet-5-5',
        effort: 'low',
        maxTokens: 10000,
        tools: [],
        estimate: { inputTokens: 2500, outputTokens: 3500 },
        always: true,
      },
    ],
  },
  {
    id: 'fitness.training-plan',
    module: 'fitness',
    name: 'Training plan',
    description:
      'Writes your training week from the workouts you logged, your weekly target, your sleep and the events ahead, with a safe build-up.',
    unit: 'plan',
    trigger: 'on-demand',
    where: { app: 'island', path: '/fitness', label: 'Fitness · Plan' },
    whenOff:
      "The week is planned by Life Island's own rules: your target spread over the week, with an easy day after a hard one.",
    defaultEnabled: true,
    steps: [
      {
        id: 'plan',
        label: 'Plan the week',
        modelEnv: 'FITNESS_AI_MODEL',
        defaultModel: 'claude-haiku-5-5',
        effort: 'low',
        maxTokens: 6000,
        tools: [],
        estimate: { inputTokens: 3500, outputTokens: 1500 },
        always: true,
      },
    ],
  },
];

export function aiTool(id: string): AiToolDefinition | undefined {
  return AI_TOOLS.find((tool) => tool.id === id);
}

/** The tool with this id; throws for an id missing from AI_TOOLS, so a typo fails at startup. */
export function requireAiTool(id: string): AiToolDefinition {
  const tool = aiTool(id);
  if (!tool)
    throw new Error(`${id} is not in AI_TOOLS (libs/contracts settings.ts)`);
  return tool;
}

/** The settings key of the model a tool uses, chosen in Settings (all its steps). */
export function aiModelSettingKey(toolId: string): string {
  return `ai-model.${toolId}`;
}

/**
 * The models you can pick for a tool: every priced model, except Haiku for a
 * tool that searches the web (dynamic web search runs on Sonnet and Opus).
 */
export function aiToolModelChoices(tool: AiToolDefinition): string[] {
  const searches = tool.steps.some((step) => step.tools.includes('web_search'));
  return Object.keys(MODEL_PRICES).filter(
    (model) => !(searches && model.startsWith('claude-haiku')),
  );
}

/** USD for the tokens and searches of one request on a model. */
export function requestCostUsd(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    webSearches?: number;
  },
): number {
  const price = priceOf(model);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite) /
      1_000_000 +
    (usage.webSearches ?? 0) * WEB_SEARCH_PRICE_USD
  );
}

/**
 * The estimated USD of one use, from the registry's typical tokens: the steps
 * that always run, on the models the service reported (its env overrides) or
 * the defaults.
 */
export function estimatedCostUsd(
  tool: AiToolDefinition,
  models: Readonly<Record<string, string>> = {},
): number {
  return tool.steps
    .filter((step) => step.always)
    .reduce(
      (sum, step) =>
        sum +
        requestCostUsd(models[step.id] ?? step.defaultModel, step.estimate),
      0,
    );
}

/** `$0.05`, `$0.0012`, `< $0.0001`: enough digits to tell two cheap tools apart. */
export function formatUsd(value: number): string {
  if (value <= 0) return '$0';
  if (value < 0.0001) return '< $0.0001';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// The app settings registry
// ---------------------------------------------------------------------------

export interface AppSettingOption {
  value: string;
  label: string;
}

export type AppSettingValue = boolean | string | number;

export interface AppSettingDefinition {
  /** `<module>.<setting>`; also the key svc-settings stores and publishes. */
  key: string;
  /** The heading it is listed under. */
  group: string;
  label: string;
  description: string;
  /**
   * `number`: a whole number between min and max, in `unit`. `time`: `HH:MM`.
   * `modules`: island areas, comma-separated (the ones you hide).
   */
  type: 'boolean' | 'choice' | 'number' | 'time' | 'modules';
  options?: readonly AppSettingOption[];
  min?: number;
  max?: number;
  unit?: string;
  default: AppSettingValue;
  /**
   * `server`: stored by svc-settings and replicated to the services that read
   * it. `browser`: kept by this browser only (the theme).
   */
  scope: 'server' | 'browser';
  /** The services that read it, for the "used by" line. */
  usedBy: readonly string[];
}

/** The master switch of every AI tool: off, no service calls a model. */
export const AI_ENABLED_SETTING = 'ai.enabled';
/** The monthly AI budget in USD; 0 means no budget. */
export const AI_BUDGET_SETTING = 'ai.monthly-budget-usd';
/** Whether AI turns off once the month's spending reaches the budget. */
export const AI_BUDGET_STOP_SETTING = 'ai.budget-stop';
/**
 * Set by svc-settings, never by you: true while the month's spending is at
 * the budget and AI_BUDGET_STOP_SETTING is on. Services read it like a
 * master switch (isAiToolEnabled).
 */
export const AI_BUDGET_REACHED_SETTING = 'ai.budget-reached';
/** The share of the budget at which Settings warns. */
export const AI_BUDGET_WARNING_SHARE = 0.8;

/** Document reading (svc-parse-worker): the daily run, its time, a run at startup. */
export const SCHEDULED_READING_SETTING = 'documents.scheduled-reading';
export const READING_TIME_SETTING = 'documents.reading-time';
export const READ_ON_START_SETTING = 'documents.read-on-start';

/** The island (shell), kept by this browser. */
export const HIDDEN_AREAS_SETTING = 'island.hidden-areas';
export const START_PAGE_SETTING = 'island.start-page';
export const ISLAND_VIEW_SETTING = 'island.view';

/** The areas of the island, for the settings that name them (the shell has their full definitions). */
export const ISLAND_AREAS = [
  { id: 'taxes', emblem: '🦖', name: '730 & taxes' },
  { id: 'groceries', emblem: '🦕', name: 'Groceries' },
  { id: 'health', emblem: '🩺', name: 'Health' },
  { id: 'work', emblem: '💼', name: 'Work' },
  { id: 'home', emblem: '🏡', name: 'Houses' },
  { id: 'studies', emblem: '📚', name: 'Studies' },
  { id: 'people', emblem: '🪪', name: 'People & IDs' },
  { id: 'cars', emblem: '🚗', name: 'Cars' },
  { id: 'agenda', emblem: '🗓️', name: 'Agenda' },
  { id: 'money', emblem: '💶', name: 'Money' },
  { id: 'goals', emblem: '🎯', name: 'Goals & habits' },
  { id: 'subscriptions', emblem: '📑', name: 'Contracts & subscriptions' },
  { id: 'mailbox', emblem: '📬', name: 'Admin mailbox' },
  { id: 'travel', emblem: '✈️', name: 'Travel' },
  { id: 'fitness', emblem: '🏃', name: 'Fitness' },
] as const;

/** The reminder windows: how many days before a renewal its warning starts. */
const ID_REMINDERS: readonly [IdDocumentType, string][] = [
  ['PASSPORT', 'Passport'],
  ['IDENTITY_CARD', 'Identity card'],
  ['DRIVING_LICENCE', 'Driving licence'],
  ['HEALTH_CARD', 'Health card'],
];
// Fines keep the law's terms and tyres the seasons' dates, so neither has a window to set.
const CAR_REMINDERS: readonly [
  Exclude<RenewableKind, 'fine' | 'tyres'>,
  string,
][] = [
  ['insurance', 'Car insurance'],
  ['road_tax', 'Road tax (bollo)'],
  ['inspection', 'Revisione'],
  ['service', 'Car service'],
  ['registration', 'Temporary registration'],
];

/** The settings key of an ID document's reminder window. */
export function idReminderSettingKey(type: IdDocumentType): string {
  return `people.warn-days.${type.toLowerCase().replace(/_/g, '-')}`;
}

/** The settings key of a car renewal's reminder window. */
export function carReminderSettingKey(kind: RenewableKind): string {
  return `cars.warn-days.${kind.replace(/_/g, '-')}`;
}

function reminder(
  key: string,
  label: string,
  days: number,
  usedBy: string,
): AppSettingDefinition {
  return {
    key,
    group: 'Reminders',
    label,
    description: `How many days before it expires the warning starts (${days} unless you change it).`,
    type: 'number',
    min: 1,
    max: 365,
    unit: 'days',
    default: days,
    scope: 'server',
    usedBy: [usedBy],
  };
}

/** Every service that runs an AI tool, for the AI settings' "used by" line. */
const AI_SERVICES = [
  'svc-parse-worker',
  'svc-work',
  'svc-cars',
  'svc-studies',
  'svc-agenda',
  'svc-money',
  'svc-goals',
  'svc-health',
  'svc-groceries',
  'svc-subscriptions',
  'svc-mailbox',
  'svc-travel',
  'svc-fitness',
] as const;

export const APP_SETTINGS: readonly AppSettingDefinition[] = [
  {
    key: 'appearance.theme',
    group: 'Appearance',
    label: 'Theme',
    description: 'Light, dark, or whatever your system uses.',
    type: 'choice',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    default: 'system',
    scope: 'browser',
    usedBy: ['shell', 'documents'],
  },
  {
    key: ISLAND_VIEW_SETTING,
    group: 'Island',
    label: 'Island view',
    description:
      'The 3D island with the area cards under it, or the cards only: lighter, for a slower device.',
    type: 'choice',
    options: [
      { value: '3d', label: '3D island' },
      { value: 'cards', label: 'Cards only' },
    ],
    default: '3d',
    scope: 'browser',
    usedBy: ['shell'],
  },
  {
    key: START_PAGE_SETTING,
    group: 'Island',
    label: 'Open on',
    description:
      'What Life Island shows when you open it: the island, or the area you used last.',
    type: 'choice',
    options: [
      { value: 'island', label: 'The island' },
      { value: 'last', label: 'Last area used' },
    ],
    default: 'island',
    scope: 'browser',
    usedBy: ['shell'],
  },
  {
    key: HIDDEN_AREAS_SETTING,
    group: 'Island',
    label: 'Areas you use',
    description:
      'Turn off an area you do not use: it leaves the island and the list of areas. Its data stays, and you can bring it back here.',
    type: 'modules',
    default: '',
    scope: 'browser',
    usedBy: ['shell'],
  },
  {
    key: AI_ENABLED_SETTING,
    group: 'AI',
    label: 'Use AI',
    description:
      'The master switch of every AI tool. Off, no service calls a model and every tool works with its own rules; each tool also has its own switch.',
    type: 'boolean',
    default: true,
    scope: 'server',
    usedBy: AI_SERVICES,
  },
  {
    key: AI_BUDGET_SETTING,
    group: 'AI',
    label: 'Monthly AI budget',
    description:
      'What AI may cost in a calendar month, in USD. Settings warns at 80%. 0 means no budget.',
    type: 'number',
    min: 0,
    max: 10000,
    unit: 'USD',
    default: 0,
    scope: 'server',
    usedBy: ['svc-settings'],
  },
  {
    key: AI_BUDGET_STOP_SETTING,
    group: 'AI',
    label: 'Turn AI off at the budget',
    description:
      'Once the month reaches the budget, every tool works with its own rules until the next month (or until you raise the budget).',
    type: 'boolean',
    default: false,
    scope: 'server',
    usedBy: AI_SERVICES,
  },
  {
    key: 'documents.auto-approve-categories',
    group: 'Documents',
    label: 'Approve suggested categories on their own',
    description:
      'Categories the AI suggests are saved at once, instead of waiting for you in Categories. Until you set it here, CATEGORY_AUTO_APPROVE in .env decides.',
    type: 'boolean',
    default: false,
    scope: 'server',
    usedBy: ['svc-parse-worker'],
  },
  {
    key: SCHEDULED_READING_SETTING,
    group: 'Documents',
    label: 'Read documents every day',
    description:
      'Reads the documents waiting in the inbox every day at the time below. Off, they are read only when you press Parse now.',
    type: 'boolean',
    default: true,
    scope: 'server',
    usedBy: ['svc-parse-worker'],
  },
  {
    key: READING_TIME_SETTING,
    group: 'Documents',
    label: 'Daily reading time',
    description:
      'When the daily reading starts. Until you set it here, PARSE_SCHEDULE in .env decides (06:00 by default).',
    type: 'time',
    default: '06:00',
    scope: 'server',
    usedBy: ['svc-parse-worker'],
  },
  {
    key: READ_ON_START_SETTING,
    group: 'Documents',
    label: 'Read when the worker starts',
    description:
      'Also reads the waiting documents each time the parse worker starts. Until you set it here, PARSE_RUN_ON_START in .env decides.',
    type: 'boolean',
    default: false,
    scope: 'server',
    usedBy: ['svc-parse-worker'],
  },
  ...ID_REMINDERS.map(([type, label]) =>
    reminder(
      idReminderSettingKey(type),
      label,
      EXPIRY_WARNING_DAYS[type],
      'svc-people',
    ),
  ),
  ...CAR_REMINDERS.map(([kind, label]) =>
    reminder(
      carReminderSettingKey(kind),
      label,
      RENEWAL_WARNING_DAYS[kind],
      'svc-cars',
    ),
  ),
  {
    key: STUDY_WEEKLY_GOAL_SETTING,
    group: 'Studies',
    label: 'Weekly study goal',
    description:
      'The hours you want to study each week. Studies measures your weeks and streak against it, and the study coach plans within it.',
    type: 'number',
    min: 1,
    max: 40,
    unit: 'hours',
    default: 5,
    scope: 'server',
    usedBy: ['svc-studies'],
  },
  {
    key: STUDY_IDLE_DAYS_SETTING,
    group: 'Reminders',
    label: 'Studies: no study time logged',
    description: `How many days without a study session before Studies nudges you (${STUDY_REMINDER_DEFAULTS.idle} unless you change it).`,
    type: 'number',
    min: 1,
    max: 60,
    unit: 'days',
    default: STUDY_REMINDER_DEFAULTS.idle,
    scope: 'server',
    usedBy: ['svc-studies'],
  },
  {
    ...reminder(
      studyReminderSettingKey('subscription'),
      'Study subscription renewal',
      STUDY_REMINDER_DEFAULTS.subscription,
      'svc-studies',
    ),
    description: `How many days before a training platform's subscription renews the warning starts (${STUDY_REMINDER_DEFAULTS.subscription} unless you change it).`,
  },
  {
    ...reminder(
      studyReminderSettingKey('exam'),
      'Exam date',
      STUDY_REMINDER_DEFAULTS.exam,
      'svc-studies',
    ),
    description: `How many days before a booked or planned exam the warning starts (${STUDY_REMINDER_DEFAULTS.exam} unless you change it).`,
  },
  reminder(
    studyReminderSettingKey('certification'),
    'Certification',
    STUDY_REMINDER_DEFAULTS.certification,
    'svc-studies',
  ),
  {
    key: AGENDA_CALENDAR_SETTING,
    group: 'Agenda',
    label: 'Italian household calendar',
    description:
      'Adds the dates that come round every year in Italy (730, IMU, ISEE, the Certificazione Unica, winter tyres) to the Agenda.',
    type: 'boolean',
    default: true,
    scope: 'server',
    usedBy: ['svc-agenda'],
  },
  {
    ...reminder(
      SUBSCRIPTIONS_WARN_DAYS_SETTING,
      'Contract cancel-by date',
      SUBSCRIPTIONS_WARN_DAYS_DEFAULT,
      'svc-subscriptions',
    ),
    description: `How many days before the last day to cancel a contract the warning starts (${SUBSCRIPTIONS_WARN_DAYS_DEFAULT} unless you change it).`,
  },
  {
    key: FITNESS_WEEKLY_MINUTES_SETTING,
    group: 'Fitness',
    label: 'Weekly active minutes',
    description:
      'The active minutes you aim for each week (the WHO suggests at least 150 moderate ones). Fitness measures your weeks and streak against it, and the training plan works within it.',
    type: 'number',
    min: 30,
    max: 1500,
    unit: 'minutes',
    default: FITNESS_WEEKLY_MINUTES_DEFAULT,
    scope: 'server',
    usedBy: ['svc-fitness'],
  },
];

export function appSetting(key: string): AppSettingDefinition | undefined {
  return APP_SETTINGS.find((setting) => setting.key === key);
}

/** The settings key of a tool's switch. */
export function aiToolSettingKey(toolId: string): string {
  return `ai-tool.${toolId}`;
}

/** Every key svc-settings accepts: the server app settings, and a switch and a model per AI tool. */
export function isKnownSettingKey(key: string): boolean {
  return (
    APP_SETTINGS.some((s) => s.key === key && s.scope === 'server') ||
    AI_TOOLS.some(
      (tool) =>
        aiToolSettingKey(tool.id) === key || aiModelSettingKey(tool.id) === key,
    )
  );
}

/** The value a stored setting must have to count, else its default applies. */
export function validSettingValue(
  key: string,
  value: unknown,
): value is AppSettingValue {
  return (
    value !== null &&
    value !== undefined &&
    invalidSettingValue(key, value) === null
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** svc-settings → every service that reads a setting: a value changed. */
export const SETTING_CHANGED_EVENT = 'settings.changed@1';
export const settingChangedV1Schema = z.object({
  key: z.string().min(1),
  value: z.json(),
  changedAt: z.iso.datetime({ offset: true }),
});
export type SettingChangedV1 = z.infer<typeof settingChangedV1Schema>;

/** A request a tool sends, as the service builds it: what the info button shows. */
export const aiRequestStepSchema = z.object({
  stepId: z.string(),
  label: z.string(),
  model: z.string(),
  effort: z.string(),
  maxTokens: z.number().int(),
  thinking: z.string(),
  tools: z.array(z.string()),
  /** The system prompt, word for word. */
  system: z.string(),
  /** The user message, with `{placeholders}` for what changes per use. */
  userTemplate: z.string(),
  /** The structured output it must return, by name, or null for free text. */
  outputFormat: z.string().nullable(),
  promptCaching: z.boolean(),
});
export type AiRequestStep = z.infer<typeof aiRequestStepSchema>;

/** A tool's service → svc-settings, at startup: how the tool calls the model now. */
export const AI_TOOL_DESCRIBED_EVENT = 'ai.tool_described@1';
export const aiToolDescribedV1Schema = z.object({
  toolId: z.string(),
  service: z.string(),
  /** False when the service has no API key (or runs its offline parser): the tool cannot call the model. */
  available: z.boolean(),
  promptVersion: z.string().nullable(),
  steps: z.array(aiRequestStepSchema),
  describedAt: z.iso.datetime({ offset: true }),
});
export type AiToolDescribedV1 = z.infer<typeof aiToolDescribedV1Schema>;

export const aiStepUsageSchema = z.object({
  stepId: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  webSearches: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().nullable().default(null),
});
export type AiStepUsage = z.infer<typeof aiStepUsageSchema>;

/** A tool's service → svc-settings, after each use: the real tokens, so Settings shows the real cost. */
export const AI_TOOL_USED_EVENT = 'ai.tool_used@1';
export const aiToolUsedV1Schema = z.object({
  toolId: z.string(),
  service: z.string(),
  outcome: z.enum(['ok', 'error']),
  error: z.string().nullable().default(null),
  steps: z.array(aiStepUsageSchema),
  usedAt: z.iso.datetime({ offset: true }),
});
export type AiToolUsedV1 = z.infer<typeof aiToolUsedV1Schema>;

/** The USD of one recorded use. */
export function useCostUsd(steps: readonly AiStepUsage[]): number {
  return steps.reduce((sum, step) => sum + requestCostUsd(step.model, step), 0);
}

// ---------------------------------------------------------------------------
// API (svc-settings)
// ---------------------------------------------------------------------------

export interface AiToolUseDto {
  usedAt: string;
  outcome: 'ok' | 'error';
  error: string | null;
  costUsd: number;
  steps: AiStepUsage[];
}

export interface AiToolDto {
  id: string;
  module: AiToolModuleId;
  /** Its own switch. */
  enabled: boolean;
  /** Its switch and the master switch: whether it calls the model now. */
  active: boolean;
  /** Whether its service can call the model at all (API key set); null before it reported. */
  available: boolean | null;
  /** The models it uses now, by step: your choice in Settings, else the service's env, else the defaults. */
  models: Record<string, string>;
  /** The model you picked for it in Settings; null while its service decides. */
  modelOverride: string | null;
  /** The models you can pick for it. */
  modelChoices: string[];
  /** Its switch or model differs from the defaults (it can be reset). */
  customized: boolean;
  estimatedCostUsd: number;
  usage: {
    uses: number;
    /** Over the recorded uses that reached the model; null before the first. */
    averageCostUsd: number | null;
    totalCostUsd: number;
    lastUsedAt: string | null;
  };
  /** How it calls the model, as its service reported it; null before it reported. */
  request: {
    service: string;
    promptVersion: string | null;
    steps: AiRequestStep[];
    describedAt: string;
  } | null;
  recentUses: AiToolUseDto[];
}

export interface AppSettingDto {
  key: string;
  value: AppSettingValue;
  /** False while it still has its default. */
  isSet: boolean;
  changedAt: string | null;
}

export interface AiBudgetDto {
  /** USD; null when there is no budget. */
  limitUsd: number | null;
  stopAtLimit: boolean;
  /** `YYYY-MM`, in the time zone of svc-settings (SETTINGS_TIMEZONE). */
  month: string;
  spentUsd: number;
  /** At 80% of the budget or more. */
  warning: boolean;
  /** At the budget or more. */
  reached: boolean;
  /** AI is off because of the budget (reached, and stopAtLimit). */
  blocking: boolean;
}

/** What AI cost in one month, in total and by tool. */
export interface AiMonthSpendDto {
  month: string;
  totalUsd: number;
  uses: number;
  byTool: Record<string, number>;
}

export interface SettingsOverviewDto {
  aiEnabled: boolean;
  tools: AiToolDto[];
  settings: AppSettingDto[];
  budget: AiBudgetDto;
  /** The last months with any use, newest first (at most 12). */
  spending: AiMonthSpendDto[];
}

export const setAiToolRequestSchema = z.object({ enabled: z.boolean() });
export type SetAiToolRequest = z.infer<typeof setAiToolRequestSchema>;

const settingValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string().min(1).max(200),
]);

export const setAppSettingRequestSchema = z.object({
  value: settingValueSchema,
});
export type SetAppSettingRequest = z.infer<typeof setAppSettingRequestSchema>;

/** Many settings at once (a backup you import): null resets one to its default. */
export const importSettingsRequestSchema = z.object({
  values: z.record(z.string(), settingValueSchema.nullable()),
});
export type ImportSettingsRequest = z.infer<typeof importSettingsRequestSchema>;

/** The file Settings exports: what you changed, on the server and in this browser. */
export const SETTINGS_FILE_FORMAT = 'life-island-settings';
export const settingsFileSchema = z.object({
  format: z.literal(SETTINGS_FILE_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  server: z.record(z.string(), settingValueSchema),
  browser: z.record(z.string(), z.string()),
});
export type SettingsFile = z.infer<typeof settingsFileSchema>;

/** Checks a value against its setting's type and options; returns an error message or null. */
export function invalidSettingValue(
  key: string,
  value: unknown,
): string | null {
  if (AI_TOOLS.some((tool) => aiToolSettingKey(tool.id) === key))
    return typeof value === 'boolean' ? null : `${key} takes true or false`;
  const modelOf = AI_TOOLS.find((tool) => aiModelSettingKey(tool.id) === key);
  if (modelOf) {
    const choices = aiToolModelChoices(modelOf);
    return typeof value === 'string' && choices.includes(value)
      ? null
      : `${key} takes one of ${choices.join(', ')}`;
  }
  const setting = appSetting(key);
  if (!setting || setting.scope !== 'server') return `${key} is not a setting`;
  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `${key} takes true or false`;
    case 'number': {
      const min = setting.min ?? 0;
      const max = setting.max ?? Number.MAX_SAFE_INTEGER;
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max
        ? null
        : `${key} takes a whole number from ${min} to ${max}`;
    }
    case 'time':
      return typeof value === 'string' && isTimeOfDay(value)
        ? null
        : `${key} takes a time of day, HH:MM`;
    case 'modules':
      return typeof value === 'string' ? null : `${key} takes area ids`;
    default:
      return setting.options?.some((option) => option.value === value)
        ? null
        : `${key} takes one of ${setting.options?.map((o) => o.value).join(', ')}`;
  }
}

/** `06:00`, `7:30`, `23:59`. */
export function isTimeOfDay(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}
