import { DatePipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  APP_SETTINGS,
  ISLAND_AREAS,
  isTimeOfDay,
  SETTINGS_FILE_FORMAT,
  settingsFileSchema,
  type AppSettingDefinition,
  type AppSettingValue,
  type SettingsFile,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  UiInput,
  UiThemeService,
  type UiThemePreference,
} from '@life-island/design-system';
import {
  BrowserSettings,
  hiddenAreas,
  SettingsApi,
} from '@life-island/settings-ui';
import { searchWords, settingMatches, SettingsSearch } from './search';

interface Group {
  name: string;
  settings: AppSettingDefinition[];
}

const THEME = 'appearance.theme';

/**
 * Every setting of the island in one place (APP_SETTINGS, libs/contracts):
 * the ones kept by this browser (the theme, the island) and the ones
 * svc-settings stores and sends to the services that read them. Each one can
 * go back to its default, and all of them can be saved to a file and loaded
 * back (a backup, or the same settings on another computer).
 */
@Component({
  selector: 'settings-app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAlert, UiBadge, UiButton, UiCard, UiIcon, UiInput],
  templateUrl: './app-settings.html',
  styleUrl: './settings.css',
})
export class AppSettingsPage {
  protected readonly api = inject(SettingsApi);
  protected readonly theme = inject(UiThemeService);
  private readonly browser = inject(BrowserSettings);
  private readonly search = inject(SettingsSearch);
  private readonly document = inject(DOCUMENT);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** A backup file read and checked, waiting for you to apply it. */
  protected readonly pending = signal<{
    name: string;
    file: SettingsFile;
  } | null>(null);
  protected readonly areas = ISLAND_AREAS;

  protected readonly groups = computed<Group[]>(() => {
    const words = searchWords(this.search.query());
    const shown = APP_SETTINGS.filter((s) => settingMatches(s, words));
    return [...new Set(shown.map((setting) => setting.group))].map((name) => ({
      name,
      settings: shown.filter((setting) => setting.group === name),
    }));
  });

  protected readonly searching = computed(
    () => searchWords(this.search.query()).length > 0,
  );

  private readonly stored = computed(() =>
    this.api.overview.hasValue() ? this.api.overview.value().settings : [],
  );

  protected value(setting: AppSettingDefinition): AppSettingValue {
    if (setting.key === THEME) return this.theme.preference();
    if (setting.scope === 'browser') return this.browser.value(setting.key);
    return (
      this.stored().find((s) => s.key === setting.key)?.value ?? setting.default
    );
  }

  protected state(setting: AppSettingDefinition) {
    return this.stored().find((s) => s.key === setting.key) ?? null;
  }

  /** It differs from its default, so it can be reset. */
  protected isSet(setting: AppSettingDefinition): boolean {
    if (setting.key === THEME) return this.theme.preference() !== 'system';
    if (setting.scope === 'browser') return this.browser.isSet(setting.key);
    return this.state(setting)?.isSet === true;
  }

  /** A server setting waits for svc-settings; a browser one never does. */
  protected locked(setting: AppSettingDefinition): boolean {
    return (
      setting.scope === 'server' &&
      (!this.api.overview.hasValue() || this.api.busy())
    );
  }

  protected areaShown(setting: AppSettingDefinition, id: string): boolean {
    return !hiddenAreas(String(this.value(setting))).has(id);
  }

  protected toggleArea(
    setting: AppSettingDefinition,
    id: string,
    shown: boolean,
  ): void {
    const hidden = hiddenAreas(String(this.value(setting)));
    if (shown) hidden.delete(id);
    else hidden.add(id);
    void this.choose(
      setting,
      ISLAND_AREAS.map((area) => area.id)
        .filter((area) => hidden.has(area))
        .join(','),
    );
  }

  protected async chooseNumber(
    setting: AppSettingDefinition,
    input: HTMLInputElement,
  ): Promise<void> {
    const value = Number(input.value);
    const min = setting.min ?? 0;
    const max = setting.max ?? Number.MAX_SAFE_INTEGER;
    if (
      input.value === '' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      this.error.set(
        `“${setting.label}” takes a whole number from ${min} to ${max}.`,
      );
      input.value = String(this.value(setting));
      return;
    }
    if (value !== this.value(setting)) await this.choose(setting, value);
  }

  protected async chooseTime(
    setting: AppSettingDefinition,
    input: HTMLInputElement,
  ): Promise<void> {
    if (!isTimeOfDay(input.value)) {
      this.error.set(`“${setting.label}” takes a time of day.`);
      input.value = String(this.value(setting));
      return;
    }
    if (input.value !== this.value(setting))
      await this.choose(setting, input.value);
  }

  protected async choose(
    setting: AppSettingDefinition,
    value: AppSettingValue,
  ): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    if (setting.key === THEME) {
      this.theme.setPreference(value as UiThemePreference);
      return;
    }
    if (setting.scope === 'browser') {
      this.browser.set(setting.key, String(value));
      return;
    }
    try {
      await this.api.setSetting(setting.key, value);
    } catch {
      this.error.set(`Could not save “${setting.label}”. Try again.`);
    }
  }

  protected async reset(setting: AppSettingDefinition): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    if (setting.key === THEME) {
      this.theme.setPreference('system');
      return;
    }
    if (setting.scope === 'browser') {
      this.browser.reset(setting.key);
      return;
    }
    try {
      await this.api.resetSetting(setting.key);
    } catch {
      this.error.set(`Could not reset “${setting.label}”. Try again.`);
    }
  }

  /** What you changed, on the server (AI tools included) and in this browser, as a file. */
  protected async exportFile(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    let server: Record<string, AppSettingValue> = {};
    try {
      server = await this.api.exportValues();
    } catch {
      this.error.set(
        'Settings could not be reached, so the file holds only this browser’s settings.',
      );
    }
    const browser = this.browser.values();
    if (this.theme.preference() !== 'system')
      browser[THEME] = this.theme.preference();
    const file: SettingsFile = {
      format: SETTINGS_FILE_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      server,
      browser,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = `life-island-settings-${file.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    const count = Object.keys(server).length + Object.keys(browser).length;
    this.notice.set(
      count
        ? `Saved ${count} settings you changed. Everything else is at its default.`
        : 'Saved. Every setting is at its default, so the file is empty.',
    );
  }

  /** Reads and checks a backup file; nothing changes until you apply it. */
  protected async readFile(input: HTMLInputElement): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    try {
      const parsed = settingsFileSchema.safeParse(
        JSON.parse(await chosen.text()),
      );
      if (!parsed.success) throw new Error('not a settings file');
      this.pending.set({ name: chosen.name, file: parsed.data });
    } catch {
      this.error.set(
        `${chosen.name} is not a Life Island settings file (Save to a file makes one).`,
      );
    }
  }

  protected count(values: Record<string, unknown>): number {
    return Object.keys(values).length;
  }

  /** Applies the file: the server values all or nothing, then this browser's. */
  protected async applyFile(): Promise<void> {
    const pending = this.pending();
    if (!pending) return;
    this.error.set(null);
    try {
      if (this.count(pending.file.server))
        await this.api.importValues(pending.file.server);
    } catch (error) {
      const detail =
        (error as { error?: { message?: string } })?.error?.message ?? '';
      this.error.set(
        `Nothing was changed: Settings refused the file. ${detail}`.trim(),
      );
      return;
    }
    for (const [key, value] of Object.entries(pending.file.browser)) {
      const setting = APP_SETTINGS.find(
        (s) => s.key === key && s.scope === 'browser',
      );
      if (!setting) continue;
      if (key === THEME) this.theme.setPreference(value as UiThemePreference);
      else this.browser.set(key, value);
    }
    this.pending.set(null);
    this.notice.set(
      `Loaded ${pending.name}: the settings in it are applied; the others stay as they were.`,
    );
  }
}
