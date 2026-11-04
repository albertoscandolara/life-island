import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** 24×24 stroke icons, drawn with `currentColor` so they follow the text colour. */
const ICONS = {
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  camera:
    'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  folder:
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z M14 3v5h5',
  x: 'M6 6l12 12 M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4',
  refresh:
    'M20 11a8 8 0 0 0-14.9-3 M4 4v4h4 M4 13a8 8 0 0 0 14.9 3 M20 20v-4h-4',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-up': 'M12 19V5 M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14 M6 13l6 6 6-6',
  alert:
    'M12 9v4 M12 17h.01 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 16v-4 M12 8h.01',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16Z M13.5 6.5l4 4',
  plus: 'M12 5v14 M5 12h14',
  external:
    'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  home: 'M4 11 12 4l8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6Z',
  flame:
    'M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-.6 2-1.8 3-3 3.5C11 7.5 10 5 10 3c-3 2.5-4 6.5-4 9.5 0 0-.1.8 0 2.5a6 6 0 0 0 6 6Z',
  droplet: 'M12 3.5s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11Z',
  wrench:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z',
  chart: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
  calendar:
    'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z M4 10h16 M8 4v4 M16 4v4',
  layers: 'M12 4 3 9l9 5 9-5Z M3 14l9 5 9-5',
  inbox: 'M3 13h5l2 3h4l2-3h5 M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z',
} as const;

export type UiIconName = keyof typeof ICONS;

@Component({
  selector: 'ui-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'ui-icon' },
  template: `<svg
    viewBox="0 0 24 24"
    [attr.width]="size()"
    [attr.height]="size()"
  >
    <path [attr.d]="path()" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class UiIcon {
  readonly name = input.required<UiIconName>();
  readonly size = input(20);
  protected readonly path = computed(() => ICONS[this.name()]);
}
