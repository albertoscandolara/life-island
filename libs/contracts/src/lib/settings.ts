import { z } from 'zod';

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

export interface AppSettingDefinition {
  /** `<module>.<setting>`; also the key svc-settings stores and publishes. */
  key: string;
  /** The heading it is listed under. */
  group: string;
  label: string;
  description: string;
  type: 'boolean' | 'choice';
  options?: readonly AppSettingOption[];
  default: boolean | string;
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
    key: AI_ENABLED_SETTING,
    group: 'AI',
    label: 'Use AI',
    description:
      'The master switch of every AI tool. Off, no service calls a model and every tool works with its own rules; each tool also has its own switch.',
    type: 'boolean',
    default: true,
    scope: 'server',
    usedBy: ['svc-parse-worker', 'svc-work'],
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
];

export function appSetting(key: string): AppSettingDefinition | undefined {
  return APP_SETTINGS.find((setting) => setting.key === key);
}

/** The settings key of a tool's switch. */
export function aiToolSettingKey(toolId: string): string {
  return `ai-tool.${toolId}`;
}

/** Every key svc-settings accepts: the server app settings and one switch per AI tool. */
export function isKnownSettingKey(key: string): boolean {
  return (
    APP_SETTINGS.some((s) => s.key === key && s.scope === 'server') ||
    AI_TOOLS.some((tool) => aiToolSettingKey(tool.id) === key)
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
  /** The models it uses now, by step (the service's env overrides, else the defaults). */
  models: Record<string, string>;
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
  value: boolean | string;
  /** False while it still has its default. */
  isSet: boolean;
  changedAt: string | null;
}

export interface SettingsOverviewDto {
  aiEnabled: boolean;
  tools: AiToolDto[];
  settings: AppSettingDto[];
}

export const setAiToolRequestSchema = z.object({ enabled: z.boolean() });
export type SetAiToolRequest = z.infer<typeof setAiToolRequestSchema>;

export const setAppSettingRequestSchema = z.object({
  value: z.union([z.boolean(), z.string().min(1).max(200)]),
});
export type SetAppSettingRequest = z.infer<typeof setAppSettingRequestSchema>;

/** Checks a value against its setting's type and options; returns an error message or null. */
export function invalidSettingValue(
  key: string,
  value: unknown,
): string | null {
  if (AI_TOOLS.some((tool) => aiToolSettingKey(tool.id) === key))
    return typeof value === 'boolean' ? null : `${key} takes true or false`;
  const setting = appSetting(key);
  if (!setting || setting.scope !== 'server') return `${key} is not a setting`;
  if (setting.type === 'boolean')
    return typeof value === 'boolean' ? null : `${key} takes true or false`;
  return setting.options?.some((option) => option.value === value)
    ? null
    : `${key} takes one of ${setting.options?.map((o) => o.value).join(', ')}`;
}
