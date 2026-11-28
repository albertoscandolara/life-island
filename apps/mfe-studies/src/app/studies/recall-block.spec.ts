import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  LEARNING_PATHS,
  type RecallCardDto,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import { STUDIES_API } from '../api/studies-api';
import { RecallBlock } from './recall-block';

const card = (id: string, round = 0): RecallCardDto => ({
  id,
  stepId: 'ai-coding.agents.mcp',
  pathId: 'ai-coding',
  question: `Question ${id}`,
  answer: `Answer ${id}`,
  round,
  dueOn: '2026-11-28',
  lastResult: null,
  ai: true,
});

function render(due: RecallCardDto[]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(RecallBlock);
  fixture.componentRef.setInput('data', {
    recall: { due, upcoming: 3, nextOn: '2026-12-05', learned: 1, ai: true },
    catalogue: [...LEARNING_PATHS],
  } as unknown as StudiesOverviewDto);
  fixture.detectChanges();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

const button = (element: HTMLElement, text: string) =>
  [...element.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  )!;

describe('RecallBlock', () => {
  it('asks one question at a time, shows the answer, and moves on when you had it', () => {
    const { fixture, element, http } = render([card('a'), card('b', 1)]);
    expect(element.textContent).toContain('1 of 2');
    expect(element.textContent).toContain('Question a');
    expect(element.textContent).toContain(
      'Agentic engineering · Model Context Protocol',
    );
    expect(element.textContent).not.toContain('Answer a');

    button(element, 'Show the answer').click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Answer a');
    expect(element.textContent).toContain('back in 7 days');

    button(element, 'I had it').click();
    http
      .expectOne(`${STUDIES_API}/recall/a`)
      .flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(element.textContent).toContain('2 of 2');
    expect(element.textContent).toContain('Question b');
    expect(element.textContent).not.toContain('Answer b');
  });

  it('says when it is all answered, and when the next one comes back', () => {
    const { fixture, element, http } = render([card('a', 2)]);
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    button(element, 'Show the answer').click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Had it: learned.');
    button(element, 'I missed it').click();
    const req = http.expectOne(`${STUDIES_API}/recall/a`);
    expect(req.request.body).toEqual({ result: 'missed' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(element.textContent).toContain('All answered.');
    expect(changed).toBe(1);
  });
});
