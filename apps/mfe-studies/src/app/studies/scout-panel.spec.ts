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
import { ScoutPanel } from './scout-panel';

const frameworks = LEARNING_PATHS.find((p) => p.id === 'frameworks')!;

function scout(over: Partial<StudyScoutDto> = {}): StudyScoutDto {
  return {
    subject: 'frameworks',
    cadence: 'auto',
    cadenceMonths: 2,
    ai: true,
    lastScan: null,
    nextScanOn: '2027-01-12',
    resources: [],
    proposals: [],
    paces: {},
    ...over,
  };
}

function render(state: StudyScoutDto) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(ScoutPanel);
  fixture.componentRef.setInput('data', {
    scout: state,
    catalogue: [...LEARNING_PATHS],
  } as unknown as StudiesOverviewDto);
  fixture.componentRef.setInput('path', frameworks);
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

describe('ScoutPanel', () => {
  it('says it keeps the path current, when it scans next, and refreshes now', () => {
    const { element, http } = render(scout());
    expect(element.textContent).toContain('Keeping this path current.');
    expect(element.textContent).toContain('every 2 months');
    button(element, 'Refresh now').click();
    http.expectOne({ method: 'POST', url: `${STUDIES_API}/scout/scans` });
  });

  it('watches one path at a time and says which one it watches now', () => {
    const { element } = render(scout({ subject: 'ai-coding' }));
    expect(element.textContent).toContain('AI coding and tools');
    expect(button(element, 'Watch this path instead')).toBeTruthy();
  });

  it('cannot refresh while the scout is off, and says why', () => {
    const { element } = render(scout({ ai: false }));
    expect(button(element, 'Refresh now').disabled).toBe(true);
    expect(element.textContent).toContain('Settings → AI tools');
  });

  it('lets you accept a proposed step', () => {
    const stage = frameworks.stages[0];
    const { element, http } = render(
      scout({
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
      }),
    );
    expect(element.textContent).toContain('Add “Signals everywhere”');
    expect(element.textContent).toContain(stage.title);
    button(element, 'Accept').click();
    const put = http.expectOne(`${STUDIES_API}/scout/changes/c1`);
    expect(put.request.body).toEqual({ decision: 'accepted' });
  });
});
