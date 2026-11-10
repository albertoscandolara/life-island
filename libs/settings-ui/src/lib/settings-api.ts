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
  aiModelSettingKey,
  aiTool,
  estimatedCostUsd,
  type AiToolDefinition,
  type AiToolDto,
  type AppSettingValue,
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

/** The link to one tool in Settings → AI tools, where it is shown highlighted. */
export function aiToolSettingsLink(
  settingsUrl: string,
  toolId: string,
): string {
  return `${settingsUrl}?tool=${encodeURIComponent(toolId)}`;
}

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
          : overview.budget.blocking
            ? 'budget reached'
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

  /** The model of a tool, for all its steps; null gives the choice back to its service. */
  async setModel(id: string, model: string | null): Promise<void> {
    await (model === null
      ? this.resetSetting(aiModelSettingKey(id))
      : this.setSetting(aiModelSettingKey(id), model));
  }

  /** Back to the default (a tool's switch or model included). */
  async resetSetting(key: string): Promise<void> {
    await this.save(
      this.http.delete<void>(
        `${SETTINGS_API}/settings/${encodeURIComponent(key)}`,
      ),
    );
  }

  /** Every value set on the server, for a backup file. */
  exportValues(): Promise<Record<string, AppSettingValue>> {
    return firstValueFrom(
      this.http.get<Record<string, AppSettingValue>>(
        `${SETTINGS_API}/settings`,
      ),
    );
  }

  /** Sets many values at once (null resets one); all or nothing. */
  async importValues(
    values: Record<string, AppSettingValue | null>,
  ): Promise<void> {
    await this.save(
      this.http.put<{ imported: number }>(`${SETTINGS_API}/settings`, {
        values,
      }),
    );
  }

  async setSetting(key: string, value: AppSettingValue): Promise<void> {
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

  private async save(
    request: ReturnType<HttpClient['put']> | ReturnType<HttpClient['delete']>,
  ): Promise<void> {
    this.saving.update((n) => n + 1);
    try {
      await firstValueFrom(request);
      this.overview.reload();
    } finally {
      this.saving.update((n) => n - 1);
    }
  }
}
