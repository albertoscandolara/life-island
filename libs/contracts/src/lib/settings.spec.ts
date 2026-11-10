import {
  aiModelSettingKey,
  appSetting,
  carReminderSettingKey,
  idReminderSettingKey,
  settingsFileSchema,
  validSettingValue,
  AI_TOOL_MODULES,
  AI_TOOLS,
  aiToolSettingKey,
  APP_SETTINGS,
  estimatedCostUsd,
  formatUsd,
  invalidSettingValue,
  isKnownSettingKey,
  priceOf,
  requestCostUsd,
  requireAiTool,
  useCostUsd,
} from './settings.js';

describe('AI_TOOLS registry', () => {
  it('has unique ids of the form <module>.<tool>, in a known module', () => {
    const ids = AI_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    const modules = AI_TOOL_MODULES.map((m) => m.id) as string[];
    for (const tool of AI_TOOLS) {
      expect(tool.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
      expect(tool.id.startsWith(`${tool.module}.`)).toBe(true);
      expect(modules).toContain(tool.module);
    }
  });

  it('gives every tool at least one step with a priced default model and an estimate', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.steps.length).toBeGreaterThan(0);
      expect(tool.whenOff.length).toBeGreaterThan(0);
      for (const step of tool.steps) {
        expect(priceOf(step.defaultModel).known).toBe(true);
        expect(step.estimate.inputTokens).toBeGreaterThan(0);
        expect(step.estimate.outputTokens).toBeGreaterThan(0);
      }
      expect(estimatedCostUsd(tool)).toBeGreaterThan(0);
    }
  });

  it('throws for a tool that is not registered', () => {
    expect(() => requireAiTool('work.nope')).toThrow(/not in AI_TOOLS/);
  });
});

describe('costs', () => {
  it('prices tokens per million and searches per use', () => {
    expect(
      requestCostUsd('claude-sonnet-5-5', {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        webSearches: 3,
      }),
    ).toBeCloseTo(2 + 1 + 0.03, 6);
  });

  it('uses the model the service reported over the default', () => {
    const feedback = requireAiTool('work.career-feedback');
    const onHaiku = estimatedCostUsd(feedback, {
      feedback: 'claude-haiku-5-5',
    });
    expect(onHaiku).toBeLessThan(estimatedCostUsd(feedback));
  });

  it('prices an unknown model like Sonnet, never as free', () => {
    const unknown = priceOf('some-future-model');
    expect(unknown.known).toBe(false);
    expect(unknown.input).toBeGreaterThan(0);
  });

  it('adds up the steps of a recorded use', () => {
    expect(
      useCostUsd([
        {
          stepId: 'a',
          model: 'claude-haiku-5-5',
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          webSearches: 0,
          latencyMs: null,
        },
        {
          stepId: 'b',
          model: 'claude-haiku-5-5',
          inputTokens: 0,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          webSearches: 0,
          latencyMs: null,
        },
      ]),
    ).toBeCloseTo(0.6, 6);
  });

  it('formats small amounts with enough digits', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00004)).toBe('< $0.0001');
    expect(formatUsd(0.0012)).toBe('$0.0012');
    expect(formatUsd(0.055)).toBe('$0.055');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});

describe('settings keys', () => {
  it('accepts the server settings and one switch per tool, not browser ones', () => {
    expect(isKnownSettingKey('ai.enabled')).toBe(true);
    expect(isKnownSettingKey(aiToolSettingKey('work.market-check'))).toBe(true);
    expect(isKnownSettingKey('appearance.theme')).toBe(false);
    expect(isKnownSettingKey('nope')).toBe(false);
  });

  it('checks values against the setting type', () => {
    expect(invalidSettingValue('ai.enabled', true)).toBeNull();
    expect(invalidSettingValue('ai.enabled', 'yes')).toMatch(/true or false/);
    expect(
      invalidSettingValue(aiToolSettingKey('documents.extract'), false),
    ).toBeNull();
    expect(invalidSettingValue('appearance.theme', 'dark')).toMatch(
      /not a setting/,
    );
  });

  it('keeps setting keys unique', () => {
    const keys = APP_SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('settings you added later', () => {
  it('accepts a model per AI tool, only among its choices', () => {
    const key = aiModelSettingKey('documents.classify');
    expect(isKnownSettingKey(key)).toBe(true);
    expect(invalidSettingValue(key, 'claude-opus-5-5')).toBeNull();
    expect(invalidSettingValue(key, 'gpt-something')).toMatch(/one of/);
    expect(
      invalidSettingValue(
        aiModelSettingKey('work.market-check'),
        'claude-haiku-5-5',
      ),
    ).toMatch(/one of/);
  });

  it('checks numbers and times against their bounds', () => {
    expect(invalidSettingValue('ai.monthly-budget-usd', 25)).toBeNull();
    expect(invalidSettingValue('ai.monthly-budget-usd', -1)).toMatch(
      /whole number/,
    );
    expect(invalidSettingValue('ai.monthly-budget-usd', 2.5)).toMatch(
      /whole number/,
    );
    expect(invalidSettingValue('documents.reading-time', '07:30')).toBeNull();
    expect(invalidSettingValue('documents.reading-time', '25:00')).toMatch(
      /HH:MM/,
    );
  });

  it('has a reminder per ID document and car renewal, with the old windows as defaults', () => {
    expect(appSetting(idReminderSettingKey('PASSPORT'))?.default).toBe(180);
    expect(appSetting(carReminderSettingKey('inspection'))?.default).toBe(60);
    expect(appSetting(carReminderSettingKey('fine'))).toBeUndefined();
  });

  it('never lets you set the budget state Settings keeps itself', () => {
    expect(isKnownSettingKey('ai.budget-reached')).toBe(false);
    expect(validSettingValue('ai.budget-reached', true)).toBe(false);
  });

  it('reads an exported settings file', () => {
    expect(
      settingsFileSchema.safeParse({
        format: 'life-island-settings',
        version: 1,
        exportedAt: '2026-11-10T21:00:00Z',
        server: { 'ai.enabled': false, 'ai.monthly-budget-usd': 5 },
        browser: { 'appearance.theme': 'dark' },
      }).success,
    ).toBe(true);
  });
});
