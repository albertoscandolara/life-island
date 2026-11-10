import { appSetting, isKnownSettingKey, requireAiTool } from './settings.js';
import {
  certificationRequestSchema,
  courseRequestSchema,
  STUDY_IDLE_DAYS_SETTING,
  STUDY_WEEKLY_GOAL_SETTING,
  studyReminderSettingKey,
  studySessionRequestSchema,
  trainingPlatformRequestSchema,
  TRAINING_PLATFORM_PRESETS,
} from './studies.js';
import {
  LEARNING_PATHS,
  pathHours,
  pathOfStep,
  pathStep,
  pathSteps,
} from './studies-paths.js';

describe('learning paths', () => {
  it('have unique ids, and every step id starts with its path and stage', () => {
    const paths = LEARNING_PATHS.map((p) => p.id);
    expect(new Set(paths).size).toBe(paths.length);
    const steps: string[] = [];
    for (const path of LEARNING_PATHS)
      for (const stage of path.stages)
        for (const step of stage.steps) {
          expect(step.id.startsWith(`${path.id}.${stage.id}.`)).toBe(true);
          steps.push(step.id);
        }
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('give every step hours, a detail, an outcome and only https links', () => {
    for (const path of LEARNING_PATHS) {
      expect(path.stages.length).toBeGreaterThan(0);
      expect(path.capstone.length).toBeGreaterThan(0);
      for (const step of pathSteps(path)) {
        expect(step.hours).toBeGreaterThan(0);
        expect(step.detail.length).toBeGreaterThan(20);
        expect(step.outcome.length).toBeGreaterThan(0);
        for (const resource of step.resources)
          if (resource.url) expect(resource.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('cover what Studies was asked for: AI coding, frameworks, infrastructure, leadership and 3D', () => {
    expect(LEARNING_PATHS.map((p) => p.topic)).toEqual(
      expect.arrayContaining([
        'ai',
        'frameworks',
        'infrastructure',
        'leadership',
        '3d',
      ]),
    );
    expect(LEARNING_PATHS.every((p) => p.level === 'beginner')).toBe(true);
  });

  it('finds a step and its path, and adds up the hours', () => {
    const step = pathStep('ai-coding.agents.mcp');
    expect(step?.title).toBe('Model Context Protocol');
    expect(pathOfStep('ai-coding.agents.mcp')?.id).toBe('ai-coding');
    expect(pathStep('nope')).toBeUndefined();
    const ai = LEARNING_PATHS[0];
    expect(pathHours(ai)).toBe(
      pathSteps(ai).reduce((sum, s) => sum + s.hours, 0),
    );
  });
});

describe('studies requests', () => {
  it('accepts a platform from the presets', () => {
    for (const preset of TRAINING_PLATFORM_PRESETS)
      expect(
        trainingPlatformRequestSchema.safeParse({
          name: preset.name,
          url: preset.url,
          plan: preset.plan,
          topics: [...preset.topics],
        }).success,
      ).toBe(true);
  });

  it('rejects a link that is not a web address', () => {
    expect(
      trainingPlatformRequestSchema.safeParse({
        name: 'X',
        url: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      courseRequestSchema.safeParse({ title: 'X', url: 'ftp://x' }).success,
    ).toBe(false);
  });

  it('checks session minutes and the path', () => {
    expect(
      studySessionRequestSchema.safeParse({ date: '2026-11-10', minutes: 45 })
        .success,
    ).toBe(true);
    expect(
      studySessionRequestSchema.safeParse({ date: '2026-11-10', minutes: 2 })
        .success,
    ).toBe(false);
    expect(
      studySessionRequestSchema.safeParse({
        date: '2026-11-10',
        minutes: 30,
        pathId: 'cooking',
      }).success,
    ).toBe(false);
  });

  it('takes a certification with dates', () => {
    expect(
      certificationRequestSchema.safeParse({
        name: 'CKAD',
        status: 'booked',
        examOn: '2027-03-01',
      }).success,
    ).toBe(true);
  });
});

describe('studies settings', () => {
  it('registers the weekly goal and every reminder window', () => {
    for (const key of [
      STUDY_WEEKLY_GOAL_SETTING,
      STUDY_IDLE_DAYS_SETTING,
      studyReminderSettingKey('subscription'),
      studyReminderSettingKey('exam'),
      studyReminderSettingKey('certification'),
    ]) {
      expect(appSetting(key)?.usedBy).toContain('svc-studies');
      expect(isKnownSettingKey(key)).toBe(true);
    }
  });

  it('registers the study coach', () => {
    const tool = requireAiTool('studies.study-coach');
    expect(tool.module).toBe('studies');
    expect(tool.where.path).toBe('/studies');
  });
});
