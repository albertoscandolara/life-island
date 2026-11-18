import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { HIDDEN_AREAS_SETTING } from '@life-island/contracts';
import { UiButton, UiDialog, UiIcon } from '@life-island/design-system';
import {
  LiRecordDialog,
  QUICK_ADD_KINDS,
  RecordEditor,
  RecordsApi,
  announceRecordsChanged,
  type QuickAddId,
  type QuickAddKind,
} from '@life-island/records-ui';
import { BrowserSettings, hiddenAreas } from '@life-island/settings-ui';
import { ISLAND_MODULES } from '../hub/modules';
import { shortcutLabel } from '../search/search';

/** The records API of one area, for the forms it keeps (records-ui). */
class AreaRecords extends RecordsApi {
  constructor(base: string) {
    super(base);
  }
}

/**
 * The island's "Add" menu: a reminder, something to buy, a workout or your
 * weight, from any page, with the same form the area uses, and a link to see
 * it once it is saved. Search hands it what you typed ("Add “milk”").
 */
@Component({
  selector: 'app-quick-add',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiRecordDialog, UiButton, UiDialog, UiIcon],
  template: `
    <ui-dialog [(open)]="menu" [heading]="heading()" size="sm">
      @if (added(); as a) {
        <p class="added" role="status">
          <ui-icon name="check" [size]="18" />
          <span>
            Added {{ a.text ? '“' + a.text + '”' : 'it' }} to
            {{ areaName(a.kind) }}.
          </span>
        </p>
      } @else {
        <p class="intro">
          Saved straight into its area, without leaving this page.
        </p>
      }
      <ul class="kinds" role="list">
        @for (kind of kinds(); track kind.id) {
          <li>
            <button type="button" class="kind" (click)="start(kind.id)">
              <span
                class="kind__emblem ui-token ui-token--sm"
                aria-hidden="true"
              >
                {{ kind.emblem }}
              </span>
              <span class="kind__label">{{ kind.label }}</span>
              <span class="kind__area">{{ areaName(kind) }}</span>
            </button>
          </li>
        }
      </ul>
      <div uiDialogFooter class="footer">
        @if (!added()) {
          <p class="tip">
            Or type it in search ({{ shortcut }}) and pick “Add it”.
          </p>
        }
        @if (added(); as a) {
          <button uiButton type="button" (click)="see(a.kind)">
            See it in {{ areaName(a.kind) }}
            <ui-icon name="chevron-right" [size]="16" />
          </button>
        }
      </div>
    </ui-dialog>

    @if (current(); as kind) {
      @let e = editors[kind.id];
      <li-record-dialog
        [heading]="kind.heading"
        size="sm"
        [fields]="kind.fields"
        [open]="e.open()"
        (openChange)="e.open.set($event)"
        [value]="e.value()"
        [saving]="e.saving()"
        [error]="e.error()"
        [removable]="false"
        (save)="save(kind, $event)"
      />
    }
  `,
  styles: `
    .footer {
      display: contents;
    }
    .tip {
      margin: 0 auto 0 0;
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .intro {
      margin: 0 0 var(--space-4);
      color: var(--text-secondary);
    }
    .added {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0 0 var(--space-4);
      color: var(--tone-success);
      font-weight: 600;
    }
    .added span {
      color: var(--text-primary);
    }
    .kinds {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .kind {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0 var(--space-3);
      align-items: center;
      width: 100%;
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--surface-card);
      color: var(--text-primary);
      font: inherit;
      text-align: start;
      cursor: pointer;
      transition:
        border-color var(--duration-fast) var(--ease-out),
        background-color var(--duration-fast) var(--ease-out);
    }
    .kind:hover {
      border-color: var(--border-strong);
      background: var(--surface-hover);
    }
    .kind:focus-visible {
      outline: 2px solid var(--focus-ring, var(--accent));
      outline-offset: 2px;
    }
    .kind__emblem {
      grid-row: span 2;
    }
    .kind__label {
      font-weight: 600;
    }
    .kind__area {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
  `,
})
export class QuickAdd {
  private readonly router = inject(Router);
  private readonly settings = inject(BrowserSettings);

  /** The menu of what can be added. */
  readonly menu = model(false);

  /** What you can add: the kinds of the areas you did not hide. */
  protected readonly kinds = computed(() => {
    const hidden = hiddenAreas(this.settings.value(HIDDEN_AREAS_SETTING));
    return QUICK_ADD_KINDS.filter((k) => !hidden.has(k.area));
  });

  protected readonly editors = Object.fromEntries(
    QUICK_ADD_KINDS.map((k) => [
      k.id,
      new RecordEditor(
        new AreaRecords(k.base),
        k.collection,
        () => this.saved(k),
        k.service,
      ),
    ]),
  ) as Record<QuickAddId, RecordEditor>;

  protected readonly shortcut = shortcutLabel();
  protected readonly current = signal<QuickAddKind | null>(null);
  /** The last thing saved, for the menu's confirmation. */
  protected readonly added = signal<{
    kind: QuickAddKind;
    text: string | null;
  } | null>(null);
  private sent: Record<string, unknown> = {};

  protected readonly heading = computed(() =>
    this.added() ? 'Added' : 'Add to the island',
  );

  /** Opens the menu, its last confirmation cleared. */
  openMenu(): void {
    this.added.set(null);
    this.menu.set(true);
  }

  /** Opens one kind's form; `text` fills its main field (from search). */
  start(id: QuickAddId, text?: string): void {
    const kind = QUICK_ADD_KINDS.find((k) => k.id === id);
    if (!kind) return;
    this.menu.set(false);
    this.current.set(kind);
    this.editors[id].add(kind.defaults(text));
  }

  protected save(kind: QuickAddKind, values: Record<string, unknown>): void {
    this.sent = values;
    this.editors[kind.id].save(values);
  }

  protected areaName(kind: QuickAddKind): string {
    return ISLAND_MODULES.find((m) => m.id === kind.area)?.name ?? kind.area;
  }

  protected see(kind: QuickAddKind): void {
    this.menu.set(false);
    void this.router.navigateByUrl(kind.path);
  }

  private saved(kind: QuickAddKind): void {
    announceRecordsChanged(kind.base, kind.collection);
    const text = kind.textKey ? this.sent[kind.textKey] : null;
    this.added.set({
      kind,
      text: typeof text === 'string' && text.trim() ? text.trim() : null,
    });
    this.menu.set(true);
  }
}
