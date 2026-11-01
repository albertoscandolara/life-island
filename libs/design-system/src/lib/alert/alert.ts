import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { UiTone } from '../status-dot/status-dot';

/** An inline message: `<ui-alert tone="danger">Upload failed</ui-alert>`. */
@Component({
  selector: 'ui-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: {
    '[attr.role]': "tone() === 'danger' ? 'alert' : 'status'",
    '[style.--_tone]': "'var(--tone-' + tone() + ')'",
    '[style.--_tone-soft]': "'var(--tone-' + tone() + '-soft)'",
  },
  template: `<ui-icon [name]="icon()" [size]="18" />
    <div class="content"><ng-content /></div>`,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--control-radius);
      border: 1px solid color-mix(in srgb, var(--_tone) 25%, transparent);
      border-inline-start: 4px solid var(--_tone);
      animation: ui-rise-in var(--duration-normal) var(--ease-out) both;
      background: var(--_tone-soft);
      color: var(--text-primary);
      font-size: var(--text-sm);
    }
    ui-icon {
      color: var(--_tone);
    }
    .content {
      flex: 1;
    }
  `,
})
export class UiAlert {
  readonly tone = input<UiTone>('info');
  protected readonly icon = computed(() =>
    this.tone() === 'danger' || this.tone() === 'warning'
      ? 'alert'
      : this.tone() === 'success'
        ? 'check'
        : 'info',
  );
}
