import {
  AI_TOOLS,
  aiToolSettingKey,
  estimatedCostUsd,
  requireAiTool,
} from '@life-island/contracts';
import { budgetOf, buildOverview, spendingByMonth } from './overview.js';

const empty = {
  values: [],
  requests: [],
  totals: [],
  recentUses: [],
  month: '2026-11',
  monthly: [],
};
const at = new Date('2026-11-10T10:00:00Z');

describe('buildOverview', () => {
  it('lists every registered tool, on by default, priced with the default models', () => {
    const overview = buildOverview(empty);
    expect(overview.aiEnabled).toBe(true);
    expect(overview.tools.map((t) => t.id)).toEqual(AI_TOOLS.map((t) => t.id));
    const feedback = overview.tools.find(
      (t) => t.id === 'work.career-feedback',
    )!;
    expect(feedback).toMatchObject({
      enabled: true,
      active: true,
      available: null,
      request: null,
      models: { feedback: 'claude-sonnet-5-5' },
      usage: { uses: 0, averageCostUsd: null, totalCostUsd: 0 },
    });
    expect(feedback.estimatedCostUsd).toBeCloseTo(
      estimatedCostUsd(requireAiTool('work.career-feedback')),
    );
  });

  it('turns every tool inactive with the master switch, keeping each switch', () => {
    const overview = buildOverview({
      ...empty,
      values: [{ key: 'ai.enabled', value: false, changedAt: at }],
    });
    expect(overview.aiEnabled).toBe(false);
    expect(overview.tools.every((t) => t.enabled && !t.active)).toBe(true);
    expect(overview.settings.find((s) => s.key === 'ai.enabled')).toMatchObject(
      {
        value: false,
        isSet: true,
      },
    );
  });

  it('uses the switch, the reported models and the real cost of a tool', () => {
    const overview = buildOverview({
      values: [
        {
          key: aiToolSettingKey('documents.extract'),
          value: false,
          changedAt: at,
        },
      ],
      requests: [
        {
          toolId: 'work.career-feedback',
          service: 'svc-work',
          available: false,
          promptVersion: null,
          describedAt: at,
          steps: [
            {
              stepId: 'feedback',
              label: 'Write the feedback',
              model: 'claude-haiku-5-5',
              effort: 'medium',
              maxTokens: 16000,
              thinking: 'adaptive',
              tools: [],
              system: 'You are…',
              userTemplate: '{dossier}',
              outputFormat: 'careerFeedbackOutput',
              promptCaching: true,
            },
          ],
        },
      ],
      totals: [
        {
          toolId: 'work.career-feedback',
          uses: 3,
          billedUses: 2,
          totalCostUsd: 0.1,
          lastUsedAt: at,
        },
      ],
      recentUses: [],
      month: '2026-11',
      monthly: [],
    });
    const extract = overview.tools.find((t) => t.id === 'documents.extract')!;
    expect(extract).toMatchObject({ enabled: false, active: false });
    const feedback = overview.tools.find(
      (t) => t.id === 'work.career-feedback',
    )!;
    // No API key in svc-work: on, but it cannot call the model.
    expect(feedback).toMatchObject({
      enabled: true,
      active: false,
      available: false,
      models: { feedback: 'claude-haiku-5-5' },
    });
    expect(feedback.usage.averageCostUsd).toBeCloseTo(0.05);
    expect(feedback.estimatedCostUsd).toBeLessThan(
      estimatedCostUsd(requireAiTool('work.career-feedback')),
    );
  });

  it('lists only the server app settings, with their defaults', () => {
    const keys = buildOverview(empty).settings.map((s) => s.key);
    expect(keys).toContain('documents.auto-approve-categories');
    expect(keys).not.toContain('appearance.theme');
  });
});

describe('models you pick', () => {
  it('uses the model you picked for every step, over what the service reported', () => {
    const overview = buildOverview({
      ...empty,
      values: [
        {
          key: 'ai-model.work.market-check',
          value: 'claude-opus-5-5',
          changedAt: at,
        },
      ],
    });
    const check = overview.tools.find((t) => t.id === 'work.market-check')!;
    expect(check.models).toEqual({
      research: 'claude-opus-5-5',
      format: 'claude-opus-5-5',
    });
    expect(check.modelOverride).toBe('claude-opus-5-5');
    expect(check.customized).toBe(true);
    // Haiku cannot run the dynamic web search.
    expect(check.modelChoices).not.toContain('claude-haiku-5-5');
  });

  it('ignores a stored model that is not one of the choices', () => {
    const overview = buildOverview({
      ...empty,
      values: [
        {
          key: 'ai-model.work.market-check',
          value: 'claude-haiku-5-5',
          changedAt: at,
        },
      ],
    });
    const check = overview.tools.find((t) => t.id === 'work.market-check')!;
    expect(check.modelOverride).toBeNull();
    expect(check.customized).toBe(false);
  });
});

describe('budget', () => {
  const spend = (month: string, toolId: string, costUsd: number) => ({
    month,
    toolId,
    uses: 1,
    costUsd,
  });

  it('has no budget until you set one', () => {
    expect(budgetOf([], '2026-11', 50)).toMatchObject({
      limitUsd: null,
      warning: false,
      reached: false,
      blocking: false,
    });
  });

  it('warns at 80% and stops AI at the budget only when you asked it to', () => {
    const limit = { key: 'ai.monthly-budget-usd', value: 10, changedAt: at };
    const stop = { key: 'ai.budget-stop', value: true, changedAt: at };
    expect(budgetOf([limit], '2026-11', 8)).toMatchObject({
      warning: true,
      reached: false,
    });
    expect(budgetOf([limit], '2026-11', 10)).toMatchObject({
      reached: true,
      blocking: false,
    });
    expect(budgetOf([limit, stop], '2026-11', 10).blocking).toBe(true);
  });

  it('counts only this month, and turns every tool off while it blocks', () => {
    const overview = buildOverview({
      ...empty,
      values: [
        { key: 'ai.monthly-budget-usd', value: 1, changedAt: at },
        { key: 'ai.budget-stop', value: true, changedAt: at },
      ],
      monthly: [
        spend('2026-10', 'work.career-feedback', 5),
        spend('2026-11', 'work.career-feedback', 0.6),
        spend('2026-11', 'documents.classify', 0.5),
      ],
    });
    expect(overview.budget.spentUsd).toBeCloseTo(1.1);
    expect(overview.budget.blocking).toBe(true);
    expect(overview.tools.every((tool) => !tool.active)).toBe(true);
    expect(overview.spending.map((m) => m.month)).toEqual([
      '2026-11',
      '2026-10',
    ]);
    expect(overview.spending[0].byTool['documents.classify']).toBeCloseTo(0.5);
  });
});

describe('spendingByMonth', () => {
  it('keeps the last 12 months, newest first', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      month: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      toolId: 'documents.classify',
      uses: 1,
      costUsd: 1,
    }));
    const months = spendingByMonth(rows);
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe('2026-02');
  });
});
