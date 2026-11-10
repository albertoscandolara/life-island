import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AI_TOOL_MODULES,
  AI_TOOLS,
  formatUsd,
  priceOf,
  type AiToolDefinition,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
} from '@life-island/design-system';
import {
  AiTool,
  DOCUMENTS_APP_URL,
  SettingsApi,
} from '@life-island/settings-ui';

/**
 * Every tool of the island that calls an AI model, grouped by module, with
 * what one use costs, how much it has cost so far, its switch and its info
 * (AI_TOOLS, libs/contracts). The same control sits next to each tool where
 * it lives.
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
    AiTool,
  ],
  templateUrl: './ai-tools.html',
  styleUrl: './settings.css',
})
export class AiToolsPage {
  protected readonly api = inject(SettingsApi);
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);
  protected readonly error = signal<string | null>(null);

  protected readonly modules = AI_TOOL_MODULES.map((module) => ({
    ...module,
    tools: AI_TOOLS.filter((tool) => tool.module === module.id),
  }));

  protected readonly aiEnabled = computed(() =>
    this.api.overview.hasValue() ? this.api.overview.value().aiEnabled : true,
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

  protected async setAll(enabled: boolean): Promise<void> {
    this.error.set(null);
    try {
      await this.api.setAiEnabled(enabled);
    } catch {
      this.error.set('Could not save the switch. Try again.');
    }
  }
}
