import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  AI_TOOLS,
  aiToolModelChoices,
  APP_SETTINGS,
  estimatedCostUsd,
  type AppSettingDto,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { SETTINGS_API } from '@life-island/settings-ui';
import { AppSettingsPage } from './app-settings';

function overview(settings: AppSettingDto[] = []): SettingsOverviewDto {
  return {
    aiEnabled: true,
    budget: {
      limitUsd: null,
      stopAtLimit: false,
      month: '2026-11',
      spentUsd: 0,
      warning: false,
      reached: false,
      blocking: false,
    },
    spending: [],
    settings: APP_SETTINGS.filter((s) => s.scope === 'server').map(
      (s) =>
        settings.find((set) => set.key === s.key) ?? {
          key: s.key,
          value: s.default,
          isSet: false,
          changedAt: null,
        },
    ),
    tools: AI_TOOLS.map((tool) => ({
      id: tool.id,
      module: tool.module,
      enabled: true,
      active: true,
      available: true,
      models: {},
      modelOverride: null,
      modelChoices: aiToolModelChoices(tool),
      customized: false,
      estimatedCostUsd: estimatedCostUsd(tool),
      usage: {
        uses: 0,
        averageCostUsd: null,
        totalCostUsd: 0,
        lastUsedAt: null,
      },
      request: null,
      recentUses: [],
    })),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  TestBed.tick();
}

describe('AppSettingsPage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  async function setup(answer = overview()) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(AppSettingsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(answer);
    await settle();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const row = (label: string) =>
      [...element.querySelectorAll<HTMLElement>('.setting')].find((li) =>
        li.querySelector('.setting__label')?.textContent?.includes(label),
      )!;
    return { fixture, http, element, row };
  }

  it('saves a reminder window in days, and refuses one out of range', async () => {
    const { http, row, fixture } = await setup();
    const input =
      row('Passport').querySelector<HTMLInputElement>('input[type=number]')!;
    expect(input.value).toBe('180');
    input.value = '400';
    input.dispatchEvent(new Event('change'));
    http.expectNone(`${SETTINGS_API}/settings/people.warn-days.passport`);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('from 1 to 365');
    input.value = '120';
    input.dispatchEvent(new Event('change'));
    const put = http.expectOne(
      `${SETTINGS_API}/settings/people.warn-days.passport`,
    );
    expect(put.request.body).toEqual({ value: 120 });
    put.flush(null);
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(overview());
  });

  it('puts a changed setting back to its default', async () => {
    const { http, row } = await setup(
      overview([
        {
          key: 'documents.reading-time',
          value: '21:00',
          isSet: true,
          changedAt: '2026-11-10T20:00:00Z',
        },
      ]),
    );
    const time = row('Daily reading time');
    expect(
      time.querySelector<HTMLInputElement>('input[type=time]')?.value,
    ).toBe('21:00');
    time.querySelector<HTMLButtonElement>('.reset')!.click();
    const reset = http.expectOne(
      `${SETTINGS_API}/settings/documents.reading-time`,
    );
    expect(reset.request.method).toBe('DELETE');
    reset.flush(null);
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(overview());
  });

  it('turns an island area off in this browser', async () => {
    const { row, fixture } = await setup();
    const cars = [
      ...row('Areas you use').querySelectorAll<HTMLLabelElement>('.area'),
    ].find((label) => label.textContent?.includes('Cars'))!;
    const box = cars.querySelector('input')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(
      localStorage.getItem('life-island.setting.island.hidden-areas'),
    ).toBe('cars');
  });

  it('loads a settings file only after you apply it, all at once', async () => {
    const { http, element, fixture } = await setup();
    const file = new File(
      [
        JSON.stringify({
          format: 'life-island-settings',
          version: 1,
          exportedAt: '2026-11-10T21:00:00Z',
          server: { 'ai.monthly-budget-usd': 10 },
          browser: { 'island.view': 'cards' },
        }),
      ],
      'backup.json',
    );
    const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(element.querySelector('.pending')?.textContent).toContain(
      '1 settings for the services',
    );
    http.expectNone(`${SETTINGS_API}/settings`);
    [...element.querySelectorAll<HTMLButtonElement>('.pending button')]
      .find((b) => b.textContent?.includes('Apply'))!
      .click();
    const put = http.expectOne(`${SETTINGS_API}/settings`);
    expect(put.request.body).toEqual({
      values: { 'ai.monthly-budget-usd': 10 },
    });
    put.flush({ imported: 1 });
    await settle();
    http.expectOne(`${SETTINGS_API}/overview`).flush(overview());
    await settle();
    expect(localStorage.getItem('life-island.setting.island.view')).toBe(
      'cards',
    );
  });

  it('refuses a file that is not a settings file', async () => {
    const { element, fixture } = await setup();
    const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['{"hello": 1}'], 'other.json')],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(element.textContent).toContain('is not a Life Island settings file');
    expect(element.querySelector('.pending')).toBeNull();
  });
});
