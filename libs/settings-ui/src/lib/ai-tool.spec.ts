import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AI_TOOLS,
  estimatedCostUsd,
  formatUsd,
  requireAiTool,
  type AiToolDto,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { AiTool } from './ai-tool';
import { SETTINGS_API } from './settings-api';

const proto = HTMLDialogElement.prototype as HTMLDialogElement &
  Record<string, unknown>;
proto.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
proto.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

@Component({
  imports: [AiTool],
  template: `<li-ai-tool toolId="work.market-check" />`,
})
class Host {}

function state(change: Partial<AiToolDto> = {}): AiToolDto {
  const tool = requireAiTool('work.market-check');
  return {
    id: tool.id,
    module: tool.module,
    enabled: true,
    active: true,
    available: true,
    models: { research: 'claude-sonnet-5-5', format: 'claude-sonnet-5-5' },
    modelOverride: null,
    modelChoices: ['claude-sonnet-5-5', 'claude-opus-5-5'],
    customized: false,
    estimatedCostUsd: estimatedCostUsd(tool),
    usage: { uses: 0, averageCostUsd: null, totalCostUsd: 0, lastUsedAt: null },
    request: null,
    recentUses: [],
    ...change,
  };
}

function overview(
  tool: AiToolDto,
  aiEnabled = true,
  blocking = false,
): SettingsOverviewDto {
  return {
    budget: {
      limitUsd: blocking ? 1 : null,
      stopAtLimit: blocking,
      month: '2026-11',
      spentUsd: blocking ? 1 : 0,
      warning: blocking,
      reached: blocking,
      blocking,
    },
    spending: [],
    aiEnabled,
    tools: [
      tool,
      ...AI_TOOLS.filter((t) => t.id !== tool.id).map((t) =>
        state({ id: t.id, module: t.module }),
      ),
    ],
    settings: [],
  };
}

/** Lets promises resolve and effects run (the resource starts its request in one). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  TestBed.tick();
}

describe('AiTool', () => {
  async function setup(answer: SettingsOverviewDto) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(Host);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(answer);
    await settle();
    fixture.detectChanges();
    return { fixture, http, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the estimated cost per use and the switch on', async () => {
    const { element } = await setup(overview(state()));
    const tool = requireAiTool('work.market-check');
    expect(element.textContent).toContain(
      `~${formatUsd(estimatedCostUsd(tool))} / check`,
    );
    const toggle =
      element.querySelector<HTMLInputElement>('input[role=switch]');
    expect(toggle?.checked).toBe(true);
    expect(toggle?.disabled).toBe(false);
  });

  it('shows the real average once the tool was used', async () => {
    const { element } = await setup(
      overview(
        state({
          usage: {
            uses: 4,
            averageCostUsd: 0.2,
            totalCostUsd: 0.8,
            lastUsedAt: null,
          },
        }),
      ),
    );
    expect(element.textContent).toContain('$0.200 / check');
    expect(element.textContent).not.toContain('~$0.200');
  });

  it('says why a tool does not call the model', async () => {
    expect(
      (await setup(overview(state(), false))).element.textContent,
    ).toContain('all AI off');
  });

  it('says when the monthly budget stopped AI', async () => {
    expect(
      (await setup(overview(state(), true, true))).element.textContent,
    ).toContain('budget reached');
  });

  it('links the badge to the tool in Settings', async () => {
    const { element } = await setup(overview(state()));
    expect(
      element
        .querySelector<HTMLAnchorElement>('a.badge-link')
        ?.getAttribute('href'),
    ).toBe('/settings/ai-tools?tool=work.market-check');
  });

  it('turns the tool off through svc-settings and reloads', async () => {
    const { element, http, fixture } = await setup(overview(state()));
    const toggle =
      element.querySelector<HTMLInputElement>('input[role=switch]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    const put = http.expectOne(`${SETTINGS_API}/ai-tools/work.market-check`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ enabled: false });
    put.flush(null);
    await settle();
    http
      .expectOne(`${SETTINGS_API}/overview`)
      .flush(overview(state({ enabled: false, active: false })));
    await settle();
    fixture.detectChanges();
    expect(element.textContent?.replace(/\s+/g, ' ')).toContain('AI · off');
  });

  it('opens the request info with the model and the prompt', async () => {
    const { element, fixture } = await setup(
      overview(
        state({
          // svc-settings reports the models the service uses, step by step.
          models: { research: 'claude-opus-5-5', format: 'claude-sonnet-5-5' },
          request: {
            service: 'svc-work',
            promptVersion: null,
            describedAt: new Date().toISOString(),
            steps: [
              {
                stepId: 'research',
                label: 'Search the web',
                model: 'claude-opus-5-5',
                effort: 'medium',
                maxTokens: 16000,
                thinking: 'adaptive (default)',
                tools: ['web_search (up to 8 searches)'],
                system: 'You research Italian salary ranges',
                userTemplate: 'Role: {role}',
                outputFormat: null,
                promptCaching: false,
              },
            ],
          },
        }),
      ),
    );
    element.querySelector<HTMLButtonElement>('button[title]')!.click();
    await settle();
    fixture.detectChanges();
    const text = element.textContent ?? '';
    expect(text).toContain('Claude Opus 5.5');
    expect(text).toContain('web_search (up to 8 searches)');
    expect(text).toContain('You research Italian salary ranges');
  });
});
