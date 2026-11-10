import { HttpClient } from '@angular/common/http';
import {
  computed,
  inject,
  Injectable,
  InjectionToken,
  isDevMode,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  AI_ENABLED_SETTING,
  aiTool,
  estimatedCostUsd,
  type AiToolDefinition,
  type AiToolDto,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { firstValueFrom } from 'rxjs';

/** svc-settings, through the gateway. */
export const SETTINGS_API = '/api/settings';

/**
 * Where the AI tools page of Settings opens. Inside Life Island it is the
 * shell's own route; the documents app provides the shell's full URL.
 */
export const AI_TOOLS_SETTINGS_URL = new InjectionToken<string>(
  'AI_TOOLS_SETTINGS_URL',
  { factory: () => '/settings/ai-tools' },
);

/** The documents app, where the document AI tools live (the shell's `documentsUrl`). */
export const DOCUMENTS_APP_URL = new InjectionToken<string>(
  'DOCUMENTS_APP_URL',
  { factory: () => (isDevMode() ? 'http://localhost:4201/' : '/documents/') },
);

/** A tool as a page shows it: the registry entry and its live state, when Settings answered. */
export interface AiToolView {
  definition: AiToolDefinition;
  state: AiToolDto | null;
  /** What one use costs: the average of the real uses once there are some, else the estimate. */
  costUsd: number;
  costIsEstimate: boolean;
  /** Calls the model now (true while Settings is unreachable: the services decide on their own). */
  active: boolean;
  /** Why it does not call the model, in a few words; null when it does. */
  offReason: string | null;
}

/**
 * The client of svc-settings every module uses: one request for the whole
 * overview per page, shared by every AI tool control on it.
 */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);
  private readonly saving = signal(0);

  readonly overview = rxResource({
    stream: () =>
      this.http.get<SettingsOverviewDto>(`${SETTINGS_API}/overview`),
  });
  /** A switch is being saved. */
  readonly busy = computed(() => this.saving() > 0);

  /** The registry entry of a tool, with its state from Settings. */
  tool(id: string): AiToolView | null {
    const definition = aiTool(id);
    if (!definition) return null;
    const overview = this.overview.hasValue() ? this.overview.value() : null;
    const state = overview?.tools.find((tool) => tool.id === id) ?? null;
    const average = state?.usage.averageCostUsd ?? null;
    const offReason = !state
      ? null
      : state.available === false
        ? 'no API key'
        : !overview?.aiEnabled
          ? 'all AI off'
          : !state.enabled
            ? 'off'
            : null;
    return {
      definition,
      state,
      costUsd:
        average ?? state?.estimatedCostUsd ?? estimatedCostUsd(definition),
      costIsEstimate: average === null,
      active: offReason === null,
      offReason,
    };
  }

  async setAiTool(id: string, enabled: boolean): Promise<void> {
    await this.save(
      this.http.put<void>(
        `${SETTINGS_API}/ai-tools/${encodeURIComponent(id)}`,
        {
          enabled,
        },
      ),
    );
  }

  async setSetting(key: string, value: boolean | string): Promise<void> {
    await this.save(
      this.http.put<void>(
        `${SETTINGS_API}/settings/${encodeURIComponent(key)}`,
        {
          value,
        },
      ),
    );
  }

  setAiEnabled(enabled: boolean): Promise<void> {
    return this.setSetting(AI_ENABLED_SETTING, enabled);
  }

  private async save(request: ReturnType<HttpClient['put']>): Promise<void> {
    this.saving.update((n) => n + 1);
    try {
      await firstValueFrom(request);
      this.overview.reload();
    } finally {
      this.saving.update((n) => n - 1);
    }
  }
}
