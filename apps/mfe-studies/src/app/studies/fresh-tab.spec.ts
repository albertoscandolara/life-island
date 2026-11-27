import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  LEARNING_PATHS,
  type StudiesOverviewDto,
  type StudyScoutDto,
} from '@life-island/contracts';
import { STUDIES_API } from '../api/studies-api';
import { FreshTab, freshGroups } from './fresh-tab';

const frameworks = LEARNING_PATHS.find((p) => p.id === 'frameworks')!;
const stage = frameworks.stages[0];
const step = stage.steps[0];

const resource = (over: object) => ({
  id: 'r',
  pathId: 'frameworks',
  stepId: step.id,
  title: 'React docs',
  url: 'https://react.dev/learn',
  kind: 'docs' as const,
  publishedOn: null,
  free: true,
  why: 'Official.',
  status: 'suggested' as const,
  outdated: null,
  foundAt: '2026-11-20T10:00:00Z',
  ...over,
});

const scout: StudyScoutDto = {
  cadence: 'auto',
  watched: [],
  monthlyScans: 4,
  scansThisMonth: 0,
  ai: true,
  lastScan: null,
  resources: [
    resource({ id: 'a' }),
    resource({ id: 'b', status: 'pinned', outdated: 'Old API' }),
    resource({ id: 'c', status: 'pinned' }),
    resource({ id: 'x', pathId: 'finance', stepId: 'finance.basics.x' }),
  ],
  proposals: [
    {
      id: 'c1',
      pathId: 'frameworks',
      kind: 'add-step',
      stageId: stage.id,
      stepId: `frameworks.${stage.id}.scout-signals`,
      title: 'Signals everywhere',
      detail: 'What changed.',
      outcome: 'You can use them.',
      stepKind: 'learn',
      hours: 3,
      reason: 'Every framework moved to signals.',
      status: 'proposed',
      createdAt: '2026-11-12T10:00:00Z',
    },
  ],
  paces: {},
};

const data = {
  scout,
  catalogue: [frameworks],
  templates: [],
} as unknown as StudiesOverviewDto;

describe('freshGroups', () => {
  it('groups what the scout found by your paths: changes, new by step, outdated', () => {
    const [group, ...rest] = freshGroups(data);
    expect(rest).toEqual([]);
    expect(group.path.id).toBe('frameworks');
    expect(group.changes.map((c) => c.id)).toEqual(['c1']);
    expect(group.steps).toEqual([
      { id: step.id, title: step.title, resources: [scout.resources[0]] },
    ]);
    expect(group.outdated.map((r) => r.id)).toEqual(['b']);
  });
});

describe('FreshTab', () => {
  function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(FreshTab);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return {
      element: fixture.nativeElement as HTMLElement,
      http: TestBed.inject(HttpTestingController),
    };
  }
  const button = (element: HTMLElement, text: string) =>
    [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(text),
    )!;

  it('accepts a proposed step and pins a new resource', () => {
    const { element, http } = render();
    expect(element.textContent).toContain('Add “Signals everywhere”');
    expect(element.textContent).toContain(stage.title);
    button(element, 'Accept').click();
    expect(
      http.expectOne(`${STUDIES_API}/scout/changes/c1`).request.body,
    ).toEqual({ decision: 'accepted' });
    button(element, 'Pin').click();
    expect(
      http.expectOne(`${STUDIES_API}/scout/resources/a`).request.body,
    ).toEqual({ status: 'pinned' });
  });
});
