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
    cadence: 'auto',
    watched: [
      {
        pathId: 'frameworks',
        watching: true,
        cadenceMonths: 2,
        nextScanOn: '2027-01-12',
        lastScan: null,
      },
    ],
    monthlyScans: 4,
    scansThisMonth: 1,
    ai: true,
    lastScan: null,
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
    templates: [],
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
  it('says when it scans this path next, the month’s scans, and refreshes it now', () => {
    const { element, http } = render(scout());
    expect(element.textContent).toContain('Kept current.');
    expect(element.textContent).toContain('every 2 months');
    expect(element.textContent).toContain('1 of 4 scans used this month');
    button(element, 'Refresh now').click();
    const post = http.expectOne({
      method: 'POST',
      url: `${STUDIES_API}/scout/scans`,
    });
    expect(post.request.body).toEqual({ pathId: 'frameworks' });
  });

  it('stops watching this path', () => {
    const { element, http } = render(scout());
    button(element, 'Stop watching').click();
    const put = http.expectOne(`${STUDIES_API}/paths/frameworks`);
    expect(put.request.body).toEqual({ status: 'following', watch: false });
  });

  it('offers to watch a path again', () => {
    const { element } = render(
      scout({
        watched: [
          {
            pathId: 'frameworks',
            watching: false,
            cadenceMonths: 2,
            nextScanOn: null,
            lastScan: null,
          },
        ],
      }),
    );
    expect(button(element, 'Watch this path again')).toBeTruthy();
  });

  it('cannot refresh while the scout is off, and says why', () => {
    const { element } = render(scout({ ai: false }));
    expect(button(element, 'Refresh now').disabled).toBe(true);
    expect(element.textContent).toContain('Settings → AI tools');
  });

  it('cannot refresh once the month’s scans are used', () => {
    const { element } = render(scout({ scansThisMonth: 4 }));
    expect(button(element, 'Refresh now').disabled).toBe(true);
  });
});
