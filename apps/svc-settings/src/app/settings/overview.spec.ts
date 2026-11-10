import {
  AI_TOOLS,
  aiToolSettingKey,
  estimatedCostUsd,
  requireAiTool,
} from '@life-island/contracts';
import { buildOverview } from './overview.js';

const empty = { values: [], requests: [], totals: [], recentUses: [] };
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
