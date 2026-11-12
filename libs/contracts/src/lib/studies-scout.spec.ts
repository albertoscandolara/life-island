import {
  aiToolModelChoices,
  AI_TOOLS,
  appSetting,
  invalidSettingValue,
} from './settings.js';
import { LEARNING_PATHS, pathOfStep, pathStep } from './studies-paths.js';
import {
  applyOutlineChanges,
  nextScanOn,
  scoutCadenceMonths,
  scoutStepId,
  STUDY_SCOUT_CADENCE_SETTING,
  STUDY_SCOUT_SUBJECT_SETTING,
  STUDY_SCOUT_TOOL,
} from './studies-scout.js';

const ai = LEARNING_PATHS.find((p) => p.id === 'ai-coding')!;
const stage = ai.stages[0];

describe('the resource scout', () => {
  it('is an AI tool that searches the web, so it never runs on Haiku', () => {
    const tool = AI_TOOLS.find((t) => t.id === STUDY_SCOUT_TOOL)!;
    expect(tool.module).toBe('studies');
    expect(tool.steps[0].tools).toContain('web_search');
    expect(
      aiToolModelChoices(tool).some((m) => m.startsWith('claude-haiku')),
    ).toBe(false);
  });

  it('watches one path at a time, picked in Settings', () => {
    const subject = appSetting(STUDY_SCOUT_SUBJECT_SETTING)!;
    expect(subject.default).toBe('none');
    expect(subject.options?.map((o) => o.value)).toEqual([
      'none',
      ...LEARNING_PATHS.map((p) => p.id),
    ]);
    expect(
      invalidSettingValue(STUDY_SCOUT_SUBJECT_SETTING, 'frameworks'),
    ).toBeNull();
    expect(
      invalidSettingValue(STUDY_SCOUT_SUBJECT_SETTING, 'cooking'),
    ).not.toBeNull();
    expect(invalidSettingValue(STUDY_SCOUT_CADENCE_SETTING, '2')).toBeNull();
  });

  it('scans fast-moving subjects every two months and the others every six', () => {
    expect(scoutCadenceMonths('auto', 'ai')).toBe(2);
    expect(scoutCadenceMonths('auto', 'leadership')).toBe(6);
    expect(scoutCadenceMonths('3', 'leadership')).toBe(3);
  });

  it('dates the next scan months after the last, at the end of a short month', () => {
    expect(nextScanOn('2026-11-12T10:00:00Z', 2)).toBe('2027-01-12');
    expect(nextScanOn('2026-12-31', 2)).toBe('2027-02-28');
  });

  it('adds an accepted step at the end of its stage and leaves out a retired one', () => {
    const retired = stage.steps[0].id;
    const added = scoutStepId(
      ai.id,
      stage.id,
      'Context engineering',
      new Set(),
    );
    const paths = applyOutlineChanges([
      {
        pathId: ai.id,
        kind: 'retire-step',
        stageId: stage.id,
        stepId: retired,
        title: null,
        detail: null,
        outcome: null,
        stepKind: null,
        hours: null,
      },
      {
        pathId: ai.id,
        kind: 'add-step',
        stageId: stage.id,
        stepId: added,
        title: 'Context engineering',
        detail: 'd',
        outcome: 'o',
        stepKind: 'learn',
        hours: 3,
      },
    ]);
    const steps = paths.find((p) => p.id === ai.id)!.stages[0].steps;
    expect(steps.at(-1)).toMatchObject({
      id: added,
      title: 'Context engineering',
      hours: 3,
      resources: [],
    });
    expect(steps.some((s) => s.id === retired)).toBe(false);
    expect(pathStep(added, paths)?.title).toBe('Context engineering');
    expect(pathOfStep(added, paths)?.id).toBe(ai.id);
    // The paths in code stay as they are.
    expect(pathStep(added)).toBeUndefined();
  });

  it('gives an added step a stable id that does not clash', () => {
    const first = scoutStepId('ai-coding', 'agents', 'Agent SDK!', new Set());
    expect(first).toBe('ai-coding.agents.scout-agent-sdk');
    expect(
      scoutStepId('ai-coding', 'agents', 'Agent SDK', new Set([first])),
    ).toBe(`${first}-2`);
  });
});
