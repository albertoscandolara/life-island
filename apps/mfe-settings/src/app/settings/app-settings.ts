import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  APP_SETTINGS,
  type AppSettingDefinition,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiThemeService,
  type UiThemePreference,
} from '@life-island/design-system';
import { SettingsApi } from '@life-island/settings-ui';

interface Group {
  name: string;
  settings: AppSettingDefinition[];
}

/**
 * Every setting of the island in one place (APP_SETTINGS, libs/contracts):
 * the ones kept by this browser (the theme) and the ones svc-settings stores
 * and sends to the services that read them.
 */
@Component({
  selector: 'settings-app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAlert, UiBadge, UiButton, UiCard],
  templateUrl: './app-settings.html',
  styleUrl: './settings.css',
})
export class AppSettingsPage {
  protected readonly api = inject(SettingsApi);
  protected readonly theme = inject(UiThemeService);
  protected readonly error = signal<string | null>(null);

  protected readonly groups: Group[] = [
    ...new Set(APP_SETTINGS.map((setting) => setting.group)),
  ].map((name) => ({
    name,
    settings: APP_SETTINGS.filter((setting) => setting.group === name),
  }));

  private readonly stored = computed(() =>
    this.api.overview.hasValue() ? this.api.overview.value().settings : [],
  );

  protected value(setting: AppSettingDefinition): boolean | string {
    if (setting.key === 'appearance.theme') return this.theme.preference();
    return (
      this.stored().find((s) => s.key === setting.key)?.value ?? setting.default
    );
  }

  protected state(setting: AppSettingDefinition) {
    return this.stored().find((s) => s.key === setting.key) ?? null;
  }

  protected async choose(
    setting: AppSettingDefinition,
    value: boolean | string,
  ): Promise<void> {
    this.error.set(null);
    if (setting.scope === 'browser') {
      if (setting.key === 'appearance.theme')
        this.theme.setPreference(value as UiThemePreference);
      return;
    }
    try {
      await this.api.setSetting(setting.key, value);
    } catch {
      this.error.set(`Could not save “${setting.label}”. Try again.`);
    }
  }
}
