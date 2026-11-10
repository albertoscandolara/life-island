import {
  AI_ENABLED_SETTING,
  AI_TOOLS,
  aiToolSettingKey,
  APP_SETTINGS,
  estimatedCostUsd,
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
}): SettingsOverviewDto {
  const value = (key: string) => input.values.find((v) => v.key === key);
  const master = value(AI_ENABLED_SETTING)?.value;
  const aiEnabled = typeof master === 'boolean' ? master : true;

  const tools: AiToolDto[] = AI_TOOLS.map((tool) => {
    const own = value(aiToolSettingKey(tool.id))?.value;
    const enabled = typeof own === 'boolean' ? own : tool.defaultEnabled;
    const request = input.requests.find((r) => r.toolId === tool.id) ?? null;
    const models = Object.fromEntries(
      tool.steps.map((step) => [
        step.id,
        request?.steps.find((s) => s.stepId === step.id)?.model ??
          step.defaultModel,
      ]),
    );
    const totals = input.totals.find((t) => t.toolId === tool.id);
    return {
      id: tool.id,
      module: tool.module,
      enabled,
      active: aiEnabled && enabled && request?.available !== false,
      available: request ? request.available : null,
      models,
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
    const valid =
      stored &&
      (typeof stored.value === 'boolean' || typeof stored.value === 'string');
    return {
      key: setting.key,
      value: valid ? (stored.value as boolean | string) : setting.default,
      isSet: Boolean(valid),
      changedAt: valid ? stored.changedAt.toISOString() : null,
    };
  });

  return { aiEnabled, tools, settings };
}
