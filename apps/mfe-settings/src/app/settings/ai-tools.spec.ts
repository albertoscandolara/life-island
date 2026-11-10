import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {
  AI_TOOL_MODULES,
  AI_TOOLS,
  aiToolModelChoices,
  estimatedCostUsd,
  type AiBudgetDto,
  type AiToolDto,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { SETTINGS_API } from '@life-island/settings-ui';
import { of } from 'rxjs';
import { AiToolsPage } from './ai-tools';
import { SettingsSearch } from './search';

const noBudget: AiBudgetDto = {
  limitUsd: null,
  stopAtLimit: false,
  month: '2026-11',
  spentUsd: 0.2,
  warning: false,
  reached: false,
  blocking: false,
};

function overview(
  aiEnabled = true,
  budget: AiBudgetDto = noBudget,
): SettingsOverviewDto {
  return {
    aiEnabled,
    settings: [],
    budget,
    spending: [
      {
        month: '2026-11',
        totalUsd: 0.2,
        uses: 2,
        byTool: { 'work.market-check': 0.2 },
      },
    ],
    tools: AI_TOOLS.map((tool): AiToolDto => ({
      id: tool.id,
      module: tool.module,
      enabled: true,
      active: aiEnabled && !budget.blocking,
      available: true,
      models: {},
      modelOverride: null,
      modelChoices: aiToolModelChoices(tool),
      customized: false,
      estimatedCostUsd: estimatedCostUsd(tool),
      usage: {
        uses: tool.id === 'work.market-check' ? 2 : 0,
        averageCostUsd: tool.id === 'work.market-check' ? 0.1 : null,
        totalCostUsd: tool.id === 'work.market-check' ? 0.2 : 0,
        lastUsedAt: null,
      },
      request: null,
      recentUses: [],
    })),
  };
}

/** Lets promises resolve and effects run (the resource starts its request in one). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  TestBed.tick();
}

describe('AiToolsPage', () => {
  async function setup(
    answer: SettingsOverviewDto,
    query: Record<string, string> = {},
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap(query)) },
        },
      ],
    });
    const fixture = TestBed.createComponent(AiToolsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(answer);
    await settle();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, http, element };
  }

  it('lists every AI tool grouped by module, with what was spent', async () => {
    const { element } = await setup(overview());
    const text = element.textContent!;
    for (const module of AI_TOOL_MODULES) expect(text).toContain(module.name);
    expect(element.querySelectorAll('.tool')).toHaveLength(AI_TOOLS.length);
    expect(element.querySelectorAll('li-ai-tool')).toHaveLength(
      AI_TOOLS.length,
    );
    expect(text).toContain('$0.200');
    expect(text).toContain('November 2026');
  });

  it('turns all AI off with the master switch', async () => {
    const { element, http } = await setup(overview());
    const master = element.querySelector<HTMLInputElement>(
      'input[aria-labelledby="all-ai"]',
    )!;
    expect(master.checked).toBe(true);
    master.checked = false;
    master.dispatchEvent(new Event('change'));
    const put = http.expectOne(`${SETTINGS_API}/settings/ai.enabled`);
    expect(put.request.body).toEqual({ value: false });
    put.flush(null);
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(overview(false));
  });

  it('picks a model for a tool, priced per use, never Haiku for a web search', async () => {
    const { element, http } = await setup(overview());
    const select = element.querySelector<HTMLSelectElement>(
      '#model-tool-work-market-check',
    )!;
    const options = [...select.options].map((o) => o.value);
    expect(options).toEqual(['', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(select.options[2].textContent).toMatch(/Claude Opus 5\.5 · ~\$/);
    select.value = 'claude-opus-5-5';
    select.dispatchEvent(new Event('change'));
    const put = http.expectOne(
      `${SETTINGS_API}/settings/ai-model.work.market-check`,
    );
    expect(put.request.body).toEqual({ value: 'claude-opus-5-5' });
    put.flush(null);
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(overview());
  });

  it('saves the monthly budget and warns when AI stopped', async () => {
    const { element, http } = await setup(
      overview(true, {
        ...noBudget,
        limitUsd: 5,
        stopAtLimit: true,
        spentUsd: 5.2,
        warning: true,
        reached: true,
        blocking: true,
      }),
    );
    expect(element.querySelector('ui-alert')?.textContent).toContain(
      'is used up',
    );
    const input = element.querySelector<HTMLInputElement>('#budget')!;
    input.value = '20';
    input.dispatchEvent(new Event('change'));
    const put = http.expectOne(
      `${SETTINGS_API}/settings/ai.monthly-budget-usd`,
    );
    expect(put.request.body).toEqual({ value: 20 });
    put.flush(null);
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(overview());
  });

  it('highlights the tool a link points to', async () => {
    const { element } = await setup(overview(), {
      tool: 'documents.classify',
    });
    expect(element.querySelector('.tool--focus')?.id).toBe(
      'tool-documents-classify',
    );
  });

  it('shows only the tools that match the search', async () => {
    const { element, fixture } = await setup(overview());
    TestBed.inject(SettingsSearch).query.set('salary market');
    fixture.detectChanges();
    const names = [...element.querySelectorAll('.tool__name')].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).toContain('Market check');
    expect(names).not.toContain('Career feedback');
    // The budget and the totals step aside while you search.
    expect(element.querySelector('#budget')).toBeNull();
  });
});
