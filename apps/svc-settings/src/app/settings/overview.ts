import {
  AI_BUDGET_SETTING,
  AI_BUDGET_STOP_SETTING,
  AI_BUDGET_WARNING_SHARE,
  AI_ENABLED_SETTING,
  AI_TOOLS,
  aiModelSettingKey,
  aiToolModelChoices,
  aiToolSettingKey,
  APP_SETTINGS,
  estimatedCostUsd,
  validSettingValue,
  type AiBudgetDto,
  type AiMonthSpendDto,
  type AiRequestStep,
  type AiStepUsage,
  type AiToolDto,
  type AppSettingDto,
  type SettingsOverviewDto,
} from '@life-island/contracts';

export interface StoredValue {
  key: string;
  value: unknown;
  changedAt: Date;
}

export interface StoredRequest {
  toolId: string;
  service: string;
  available: boolean;
  promptVersion: string | null;
  steps: AiRequestStep[];
  describedAt: Date;
}

export interface StoredUse {
  toolId: string;
  outcome: 'ok' | 'error';
  error: string | null;
  costUsd: number;
  steps: AiStepUsage[];
  usedAt: Date;
}

export interface UsageTotals {
  toolId: string;
  uses: number;
  /** Uses that reached the model (some tokens billed). */
  billedUses: number;
  totalCostUsd: number;
  lastUsedAt: Date | null;
}

/** How many recent uses each tool lists, for the info button. */
export const RECENT_USES = 5;

/** What one tool cost in one month. */
export interface MonthToolSpend {
  month: string;
  toolId: string;
  uses: number;
  costUsd: number;
}

/** A stored value that is valid for its key, else undefined (its default applies). */
function storedValue(values: readonly StoredValue[], key: string): unknown {
  const value = values.find((v) => v.key === key)?.value;
  return validSettingValue(key, value) ? value : undefined;
}

/**
 * The month's budget: how much is spent against it, and whether AI must stop
 * (svc-settings then sets AI_BUDGET_REACHED_SETTING for every service).
 */
export function budgetOf(
  values: readonly StoredValue[],
  month: string,
  spentUsd: number,
): AiBudgetDto {
  const limit = storedValue(values, AI_BUDGET_SETTING);
  const limitUsd = typeof limit === 'number' && limit > 0 ? limit : null;
  const stopAtLimit = storedValue(values, AI_BUDGET_STOP_SETTING) === true;
  const reached = limitUsd !== null && spentUsd >= limitUsd;
  return {
    limitUsd,
    stopAtLimit,
    month,
    spentUsd,
    warning:
      limitUsd !== null && spentUsd >= limitUsd * AI_BUDGET_WARNING_SHARE,
    reached,
    blocking: reached && stopAtLimit,
  };
}

/** Months newest first, each with its total and its tools. */
export function spendingByMonth(
  rows: readonly MonthToolSpend[],
): AiMonthSpendDto[] {
  const months = new Map<string, AiMonthSpendDto>();
  for (const row of rows) {
    const month = months.get(row.month) ?? {
      month: row.month,
      totalUsd: 0,
      uses: 0,
      byTool: {},
    };
    month.totalUsd += row.costUsd;
    month.uses += row.uses;
    month.byTool[row.toolId] = (month.byTool[row.toolId] ?? 0) + row.costUsd;
    months.set(row.month, month);
  }
  return [...months.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12);
}

/**
 * Settings as the page shows it: every registered tool with its switch, the
 * models its service reported, its estimated and real cost per use, and every
 * server app setting with its value or default.
 */
export function buildOverview(input: {
  values: StoredValue[];
  requests: StoredRequest[];
  totals: UsageTotals[];
  recentUses: StoredUse[];
  /** `YYYY-MM` of now, and what each tool cost per month. */
  month: string;
  monthly: MonthToolSpend[];
}): SettingsOverviewDto {
  const value = (key: string) => storedValue(input.values, key);
  const master = value(AI_ENABLED_SETTING);
  const aiEnabled = typeof master === 'boolean' ? master : true;
  const spending = spendingByMonth(input.monthly);
  const budget = budgetOf(
    input.values,
    input.month,
    spending.find((m) => m.month === input.month)?.totalUsd ?? 0,
  );

  const tools: AiToolDto[] = AI_TOOLS.map((tool) => {
    const own = value(aiToolSettingKey(tool.id));
    const enabled = typeof own === 'boolean' ? own : tool.defaultEnabled;
    const override = value(aiModelSettingKey(tool.id));
    const modelOverride = typeof override === 'string' ? override : null;
    const request = input.requests.find((r) => r.toolId === tool.id) ?? null;
    const models = Object.fromEntries(
      tool.steps.map((step) => [
        step.id,
        modelOverride ??
          request?.steps.find((s) => s.stepId === step.id)?.model ??
          step.defaultModel,
      ]),
    );
    const totals = input.totals.find((t) => t.toolId === tool.id);
    return {
      id: tool.id,
      module: tool.module,
      enabled,
      active:
        aiEnabled &&
        enabled &&
        !budget.blocking &&
        request?.available !== false,
      available: request ? request.available : null,
      models,
      modelOverride,
      modelChoices: aiToolModelChoices(tool),
      customized: own !== undefined || modelOverride !== null,
      estimatedCostUsd: estimatedCostUsd(tool, models),
      usage: {
        uses: totals?.uses ?? 0,
        averageCostUsd:
          totals && totals.billedUses > 0
            ? totals.totalCostUsd / totals.billedUses
            : null,
        totalCostUsd: totals?.totalCostUsd ?? 0,
        lastUsedAt: totals?.lastUsedAt?.toISOString() ?? null,
      },
      request: request
        ? {
            service: request.service,
            promptVersion: request.promptVersion,
            steps: request.steps,
            describedAt: request.describedAt.toISOString(),
          }
        : null,
      recentUses: input.recentUses
        .filter((use) => use.toolId === tool.id)
        .sort((a, b) => b.usedAt.getTime() - a.usedAt.getTime())
        .slice(0, RECENT_USES)
        .map((use) => ({
          usedAt: use.usedAt.toISOString(),
          outcome: use.outcome,
          error: use.error,
          costUsd: use.costUsd,
          steps: use.steps,
        })),
    };
  });

  const settings: AppSettingDto[] = APP_SETTINGS.filter(
    (setting) => setting.scope === 'server',
  ).map((setting) => {
    const stored = value(setting.key);
    const valid = stored !== undefined;
    return {
      key: setting.key,
      value: valid ? (stored as AppSettingDto['value']) : setting.default,
      isSet: valid,
      changedAt: valid
        ? (input.values
            .find((v) => v.key === setting.key)
            ?.changedAt.toISOString() ?? null)
        : null,
    };
  });

  return { aiEnabled, tools, settings, budget, spending };
}
