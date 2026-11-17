import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  ElementRef,
  inject,
  input,
  model,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { UiButton } from '../button/button';
import { UiDialogBase } from '../dialog/dialog-base';
import { UiIcon } from '../icon/icon';

let nextId = 0;

/**
 * One subject of a guide: a tab of the drawer, with its own short intro.
 * Whatever goes inside is reading matter and takes the guide's typography
 * (headings, paragraphs, lists, tables, `<details>` folds, `.ui-info-sources`).
 */
@Component({
  selector: 'ui-info-topic',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The topic styles the reading matter projected into it, so its styles are global
  // and scoped by the `.ui-info-topic` class instead.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-info-topic',
    role: 'tabpanel',
    '[id]': 'panelId',
    '[attr.aria-labelledby]': 'tabId',
    '[hidden]': '!active()',
  },
  template: `@if (intro()) {
      <p class="ui-info-topic__intro">{{ intro() }}</p>
    }
    <ng-content />`,
  styleUrl: './info-topic.css',
})
export class UiInfoTopic {
  /** The topic's id, for `[(topic)]` and `show('glossary')`. */
  readonly key = input.required<string>();
  /** Its name on the tab. */
  readonly label = input.required<string>();
  /** One or two sentences under the tabs: what this topic is about. */
  readonly intro = input('');

  private readonly guide = inject(UiInfoGuide);
  private readonly uid = nextId++;
  readonly panelId = `ui-info-panel-${this.uid}`;
  readonly tabId = `ui-info-tab-${this.uid}`;
  protected readonly active = computed(
    () => this.guide.current()?.key() === this.key(),
  );
}

/**
 * The guide of a page: reading matter that is not your data (what a thing is,
 * how it works, the words it uses), kept out of the page and opened on demand.
 * It renders a small "Guide" button where you place it (usually in the page
 * header's `uiPageActions`) and a drawer from the side, full screen on a
 * phone, with one tab per `<ui-info-topic>`. The book mark, the blue band and
 * the ruled paper are the same in every module, so a guide always reads as a
 * guide.
 *
 * ```html
 * <ui-info-guide uiPageActions heading="About the 730" [(open)]="guideOpen" [(topic)]="guideTopic">
 *   <ui-info-topic key="basics" label="The 730, in short" intro="…">…</ui-info-topic>
 *   <ui-info-topic key="glossary" label="Glossary">…</ui-info-topic>
 * </ui-info-guide>
 * ```
 *
 * Open it from elsewhere on the page with `[(open)]` and `[(topic)]`, or with
 * `show('glossary')` on a template reference.
 */
@Component({
  selector: 'ui-info-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiIcon],
  templateUrl: './info-guide.html',
  styleUrl: './info-guide.css',
})
export class UiInfoGuide extends UiDialogBase {
  /** The text of the button that opens it. */
  readonly label = input('Guide');
  /** The topic shown; the first one when empty or unknown. */
  readonly topic = model('');
  /** Hides the button, for a guide opened only from elsewhere on the page. */
  readonly buttonless = input(false);

  protected readonly topics = contentChildren(UiInfoTopic);
  readonly current = computed(() => {
    const topics = this.topics();
    return topics.find((t) => t.key() === this.topic()) ?? topics[0] ?? null;
  });

  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  constructor() {
    super();
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) element.showModal();
      if (!this.open() && element.open) element.close();
    });
  }

  /** Opens the guide, on a topic when given. */
  show(topic?: string): void {
    if (topic) this.topic.set(topic);
    this.open.set(true);
  }

  protected pick(topic: UiInfoTopic): void {
    this.topic.set(topic.key());
    this.body()?.nativeElement.scrollTo?.({ top: 0 });
  }

  /** Arrow keys move along the tabs, as in any tablist. */
  protected onTabKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const topics = this.topics();
    const at = topics.indexOf(this.current() as UiInfoTopic);
    const next = topics[(at + step + topics.length) % topics.length];
    this.pick(next);
    (
      this.dialog().nativeElement.querySelector(
        `#${next.tabId}`,
      ) as HTMLElement | null
    )?.focus();
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    if (this.dismissible()) this.close();
  }

  protected onClick(event: MouseEvent): void {
    // A click on the <dialog> itself (not its panel) is a click on the backdrop.
    if (event.target === this.dialog().nativeElement && this.dismissible())
      this.close();
  }
}
