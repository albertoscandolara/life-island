import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AI_TOOL_MODULES,
  AI_TOOLS,
  estimatedCostUsd,
  type AiToolDto,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { SETTINGS_API } from '@life-island/settings-ui';
import { AiToolsPage } from './ai-tools';

function overview(aiEnabled = true): SettingsOverviewDto {
  return {
    aiEnabled,
    settings: [],
    tools: AI_TOOLS.map((tool): AiToolDto => ({
      id: tool.id,
      module: tool.module,
      enabled: true,
      active: aiEnabled,
      available: true,
      models: {},
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
  async function setup(answer: SettingsOverviewDto) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
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
    const headings = element.textContent!;
    for (const module of AI_TOOL_MODULES)
      expect(headings).toContain(module.name);
    expect(element.querySelectorAll('.tool')).toHaveLength(AI_TOOLS.length);
    expect(element.querySelectorAll('li-ai-tool')).toHaveLength(
      AI_TOOLS.length,
    );
    expect(element.textContent).toContain('$0.20');
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
});
