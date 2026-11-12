import { DatePipe, DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AI_BUDGET_SETTING,
  AI_BUDGET_STOP_SETTING,
  AI_TOOL_MODULES,
  AI_TOOLS,
  aiTool,
  APP_SETTINGS,
  appSetting,
  estimatedCostUsd,
  formatUsd,
  priceOf,
  type AiMonthSpendDto,
  type AiToolDefinition,
  type AppSettingDefinition,
  type AppSettingValue,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  UiInput,
  UiProgressBar,
} from '@life-island/design-system';
import {
  AiTool,
  DOCUMENTS_APP_URL,
  SettingsApi,
} from '@life-island/settings-ui';
import { map } from 'rxjs';
import { searchWords, SettingsSearch, toolMatches } from './search';

/**
 * Every tool of the island that calls an AI model, grouped by module, with
 * what one use costs, how much it has cost so far, its switch, the model it
 * runs on and its info (AI_TOOLS, libs/contracts); the monthly budget and
 * what AI cost month by month. The same control sits next to each tool where
 * it lives, and its badge links here (`?tool=<id>` highlights the tool).
 */
@Component({
  selector: 'settings-ai-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiIcon,
    UiInput,
    UiProgressBar,
    AiTool,
  ],
  templateUrl: './ai-tools.html',
  styleUrl: './settings.css',
})
export class AiToolsPage {
  protected readonly api = inject(SettingsApi);
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);
  private readonly search = inject(SettingsSearch);
  private readonly document = inject(DOCUMENT);
  protected readonly error = signal<string | null>(null);

  /** The tool a link pointed to: highlighted and scrolled to. */
  protected readonly focused = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.get('tool'))),
    { initialValue: null },
  );

  protected readonly modules = computed(() => {
    const words = searchWords(this.search.query());
    return AI_TOOL_MODULES.map((module) => ({
      ...module,
      tools: AI_TOOLS.filter(
        (tool) =>
          tool.module === module.id &&
          (toolMatches(tool, words) || tool.id === this.focused()),
      ),
    })).filter((module) => module.tools.length > 0);
  });

  protected readonly searching = computed(
    () => searchWords(this.search.query()).length > 0,
  );

  protected readonly aiEnabled = computed(() =>
    this.api.overview.hasValue() ? this.api.overview.value().aiEnabled : true,
  );

  protected readonly budget = computed(() =>
    this.api.overview.hasValue() ? this.api.overview.value().budget : null,
  );

  protected readonly spending = computed(() =>
    this.api.overview.hasValue() ? this.api.overview.value().spending : [],
  );

  protected readonly totals = computed(() => {
    const tools = this.api.overview.hasValue()
      ? this.api.overview.value().tools
      : [];
    return {
      active: tools.filter((tool) => tool.active).length,
      spent: tools.reduce((sum, tool) => sum + tool.usage.totalCostUsd, 0),
      uses: tools.reduce((sum, tool) => sum + tool.usage.uses, 0),
      noKey: tools.filter((tool) => tool.available === false).length,
    };
  });

  protected readonly count = AI_TOOLS.length;
  protected readonly budgetMax = appSetting(AI_BUDGET_SETTING)?.max ?? 10000;

  constructor() {
    // Scroll the linked tool into view once it is on the page.
    afterRenderEffect(() => {
      const id = this.focused();
      if (!id || !this.api.overview.hasValue()) return;
      this.document
        .getElementById(this.anchor(id))
        ?.scrollIntoView({ block: 'center' });
    });
  }

  protected anchor(id: string): string {
    return `tool-${id.replace(/\./g, '-')}`;
  }

  protected view(id: string) {
    return this.api.tool(id);
  }

  protected models(tool: AiToolDefinition): string {
    const state = this.api.tool(tool.id)?.state;
    const ids = [
      ...new Set(
        tool.steps.map((step) => state?.models[step.id] ?? step.defaultModel),
      ),
    ];
    return ids.map((id) => priceOf(id).label).join(' + ');
  }

  /** The models you can pick, each with what one use would cost on it. */
  protected modelOptions(tool: AiToolDefinition) {
    const state = this.api.tool(tool.id)?.state;
    return (state?.modelChoices ?? []).map((model) => ({
      model,
      label: `${priceOf(model).label} · ~${formatUsd(
        estimatedCostUsd(
          tool,
          Object.fromEntries(tool.steps.map((step) => [step.id, model])),
        ),
      )} / ${tool.unit}`,
    }));
  }

  /** What "the service's default" means for this tool now. */
  protected defaultModels(tool: AiToolDefinition): string {
    const request = this.api.tool(tool.id)?.state?.request;
    const ids = [
      ...new Set(
        tool.steps.map(
          (step) =>
            request?.steps.find((s) => s.stepId === step.id)?.model ??
            step.defaultModel,
        ),
      ),
    ];
    return ids.map((id) => priceOf(id).label).join(' + ');
  }

  /** Where the tool lives: a route of the island, or a page of the documents app. */
  protected where(tool: AiToolDefinition): {
    href: string | null;
    route: string | null;
  } {
    return tool.where.app === 'island'
      ? { href: null, route: tool.where.path }
      : {
          href: `${this.documentsUrl}${tool.where.path.replace(/^\//, '')}`,
          route: null,
        };
  }

  protected usd(value: number): string {
    return formatUsd(value);
  }

  /** "November 2026" from `2026-11`. */
  protected monthName(month: string): string {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  /** The tools of a month, most expensive first. */
  protected monthTools(month: AiMonthSpendDto) {
    return Object.entries(month.byTool)
      .filter(([, cost]) => cost > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, cost]) => ({
        name: aiTool(id)?.name ?? id,
        cost,
        share: month.totalUsd > 0 ? (cost / month.totalUsd) * 100 : 0,
      }));
  }

  /** The month's spending as a share of the budget, for the bar. */
  protected budgetShare(): number | null {
    const budget = this.budget();
    if (!budget?.limitUsd) return null;
    return Math.min(100, (budget.spentUsd / budget.limitUsd) * 100);
  }

  protected async setAll(enabled: boolean): Promise<void> {
    await this.run('Could not save the switch. Try again.', () =>
      this.api.setAiEnabled(enabled),
    );
  }

  protected async setModel(
    tool: AiToolDefinition,
    model: string,
  ): Promise<void> {
    await this.run(
      `Could not change the model of ${tool.name}. Try again.`,
      () => this.api.setModel(tool.id, model === '' ? null : model),
    );
  }

  /** The choices that steer a tool (the path the resource scout keeps current). */
  protected toolSettings(toolId: string): AppSettingDefinition[] {
    return APP_SETTINGS.filter(
      (s) => s.aiTool === toolId && s.type === 'choice',
    );
  }

  protected settingValue(setting: AppSettingDefinition): AppSettingValue {
    const stored = this.api.overview.hasValue()
      ? this.api.overview.value().settings.find((s) => s.key === setting.key)
      : undefined;
    return stored?.value ?? setting.default;
  }

  protected async setToolSetting(
    setting: AppSettingDefinition,
    value: string,
  ): Promise<void> {
    await this.run(`Could not save “${setting.label}”. Try again.`, () =>
      this.api.setSetting(setting.key, value),
    );
  }

  /** The tool's switch and model back to their defaults. */
  protected async resetTool(tool: AiToolDefinition): Promise<void> {
    await this.run(`Could not reset ${tool.name}. Try again.`, async () => {
      await this.api.resetSetting(`ai-tool.${tool.id}`);
      await this.api.setModel(tool.id, null);
    });
  }

  protected async setBudget(input: HTMLInputElement): Promise<void> {
    const value = Number(input.value || 0);
    if (!Number.isInteger(value) || value < 0 || value > this.budgetMax) {
      this.error.set(
        `The budget takes whole dollars from 0 (no budget) to ${this.budgetMax}.`,
      );
      input.value = String(this.budget()?.limitUsd ?? 0);
      return;
    }
    if (value === (this.budget()?.limitUsd ?? 0)) return;
    await this.run('Could not save the budget. Try again.', () =>
      value === 0
        ? this.api.resetSetting(AI_BUDGET_SETTING)
        : this.api.setSetting(AI_BUDGET_SETTING, value),
    );
  }

  protected async setBudgetStop(stop: boolean): Promise<void> {
    await this.run('Could not save the switch. Try again.', () =>
      this.api.setSetting(AI_BUDGET_STOP_SETTING, stop),
    );
  }

  private async run(failure: string, save: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await save();
    } catch {
      this.error.set(failure);
    }
  }
}
