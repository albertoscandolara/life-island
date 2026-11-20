import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  GROCERY_CATEGORY_LABELS,
  GROCERY_ITEM_CATEGORIES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_IMAGE_TYPES,
  type GroceryItemCategory,
  type GroceryItemStatsDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiDialog,
  UiIcon,
  UiLineChart,
  type UiChartSeries,
} from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { dateText, errorText, euro, monthText } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { GroceriesApi } from '../api/groceries-api';

const SERVICE = 'svc-groceries';
const LINK = /^https?:\/\/\S+$/i;

/**
 * One item of "What you buy": its price over time, and what you keep about
 * it. Rename it (every receipt line follows, and an item of the same name
 * becomes one with it), move it to another aisle, add its link and photo, or
 * remove it from the list (its receipt lines stay in your spending).
 */
@Component({
  selector: 'groceries-item-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntityLink, UiAlert, UiButton, UiDialog, UiIcon, UiLineChart],
  template: `
    <ui-dialog
      [(open)]="open"
      [heading]="item()?.name ?? 'Item'"
      size="md"
      [dismissible]="!busy()"
    >
      @if (item(); as i) {
        <div class="top">
          <div class="photo">
            @if (api.itemImageUrl(i); as src) {
              <img [src]="src" [alt]="'Photo of ' + i.name" />
            } @else {
              <ui-icon name="camera" [size]="28" />
            }
          </div>
          <div class="photo-actions">
            <input
              #file
              type="file"
              hidden
              [accept]="imageAccept"
              (change)="uploadPhoto(i, $event)"
            />
            <button
              uiButton
              variant="secondary"
              size="sm"
              type="button"
              [disabled]="busy() || !i.id"
              (click)="file.click()"
            >
              <ui-icon name="upload" [size]="16" />
              {{ i.imageVersion ? 'Change photo' : 'Add a photo' }}
            </button>
            @if (i.imageVersion) {
              <button
                uiButton
                variant="ghost"
                size="sm"
                type="button"
                [disabled]="busy()"
                (click)="removePhoto(i)"
              >
                <ui-icon name="trash" [size]="16" /> Remove photo
              </button>
            }
            <small class="hint"
              >PNG, JPEG, WebP or GIF, up to {{ imageMaxMb }} MB.</small
            >
          </div>
        </div>

        <form
          class="form"
          [id]="formId"
          novalidate
          (submit)="$event.preventDefault(); save(i)"
        >
          <label class="field wide">
            <span class="label">Name <span aria-hidden="true">*</span></span>
            <input
              class="ui-input"
              maxlength="120"
              [value]="name()"
              [attr.aria-invalid]="!!nameError()"
              (input)="name.set($any($event.target).value)"
            />
            @if (nameError(); as message) {
              <small class="error" role="alert">{{ message }}</small>
            } @else {
              <small class="hint"
                >Renames it on every receipt. The name of another item merges
                the two.</small
              >
            }
          </label>
          <label class="field">
            <span class="label">Aisle</span>
            <select
              class="ui-input"
              (change)="category.set($any($event.target).value)"
            >
              @for (c of categories; track c) {
                <option [value]="c" [selected]="c === category()">
                  {{ categoryLabel(c) }}
                </option>
              }
            </select>
          </label>
          <label class="field">
            <span class="label">Link</span>
            <input
              class="ui-input"
              type="url"
              maxlength="500"
              placeholder="https://"
              [value]="link()"
              [attr.aria-invalid]="!!linkError()"
              (input)="link.set($any($event.target).value)"
            />
            @if (linkError(); as message) {
              <small class="error" role="alert">{{ message }}</small>
            } @else if (i.link) {
              <a class="hint" [href]="i.link" target="_blank" rel="noopener"
                >Open the link</a
              >
            } @else {
              <small class="hint">Its page in a shop, to buy it again.</small>
            }
          </label>
        </form>

        <h3 class="sub">The price you paid</h3>
        @if (chart(); as c) {
          <ui-line-chart
            [categories]="c.categories"
            [series]="c.series"
            [zero]="false"
            [area]="false"
            [title]="c.title"
            [format]="euro"
            [height]="160"
            [ariaLabel]="'Price of ' + i.name + ' over time'"
          />
        }
        @if (i.prices.length) {
          <div class="li-table-wrap">
            <table class="li-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Shop</th>
                  <th scope="col" class="li-num">Price</th>
                </tr>
              </thead>
              <tbody>
                @for (p of pricesNewestFirst(); track $index) {
                  <tr>
                    <td>{{ dateText(p.date) }}</td>
                    <td>
                      <li-entity-link kind="organization" [name]="p.merchant" />
                    </td>
                    <td class="li-num">{{ euro(p.price) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="hint">No unit price on its receipts.</p>
        }

        @if (!i.id) {
          <ui-alert tone="warning">
            This item can't be changed yet: the Groceries service is running an
            older version. Restart svc-groceries to update it, then try again.
          </ui-alert>
        }
        @if (error(); as message) {
          <ui-alert tone="danger">{{ message }}</ui-alert>
        }
      }
      <div uiDialogFooter class="footer">
        @if (item(); as i) {
          @if (confirming()) {
            <span class="confirm">
              Remove from What you buy?
              <button
                uiButton
                variant="danger"
                size="sm"
                type="button"
                [loading]="busy()"
                (click)="remove(i)"
              >
                Yes, remove
              </button>
              <button
                uiButton
                variant="ghost"
                size="sm"
                type="button"
                (click)="confirming.set(false)"
              >
                Keep
              </button>
            </span>
          } @else {
            <button
              uiButton
              variant="ghost"
              type="button"
              class="delete"
              [disabled]="busy() || !i.id"
              title="It stays on its receipts and in your spending"
              (click)="confirming.set(true)"
            >
              <ui-icon name="trash" [size]="16" /> Delete
            </button>
          }
        }
        <span class="spacer"></span>
        <button
          uiButton
          variant="secondary"
          type="button"
          [disabled]="busy()"
          (click)="open.set(false)"
        >
          Cancel
        </button>
        <button
          uiButton
          type="submit"
          [attr.form]="formId"
          [loading]="busy()"
          [disabled]="!item()?.id"
        >
          Save
        </button>
      </div>
    </ui-dialog>
  `,
  styles: `
    .top {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4);
      align-items: center;
      margin-bottom: var(--space-4);
    }
    .photo {
      display: grid;
      place-items: center;
      width: 6rem;
      height: 6rem;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);
      color: var(--text-muted);
    }
    .photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .photo-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
    }
    .photo-actions .hint {
      flex-basis: 100%;
    }
    .form {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
      gap: var(--space-3) var(--space-4);
      margin-bottom: var(--space-4);
    }
    .field {
      display: grid;
      gap: var(--space-1);
      align-content: start;
      min-width: 0;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .label {
      color: var(--text-secondary);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .hint {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .error {
      color: var(--tone-danger);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .sub {
      margin: 0 0 var(--space-2);
      font-size: var(--text-sm);
    }
    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
    }
    .spacer {
      flex: 1;
    }
    .confirm {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      color: var(--tone-danger);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .delete {
      color: var(--tone-danger);
    }
  `,
})
export class ItemDialog {
  protected readonly api = inject(GroceriesApi);

  readonly open = model(false);
  readonly item = input<GroceryItemStatsDto | null>(null);
  /** Something changed: reload the page. */
  readonly changed = output<void>();

  private static next = 0;
  protected readonly formId = `groceries-item-form-${ItemDialog.next++}`;
  protected readonly categories = GROCERY_ITEM_CATEGORIES;
  protected readonly imageAccept = UPLOAD_IMAGE_TYPES.join(',');
  protected readonly imageMaxMb = UPLOAD_IMAGE_MAX_BYTES / 1024 / 1024;
  protected readonly euro = euro;
  protected readonly dateText = dateText;

  protected readonly name = signal('');
  protected readonly category = signal<string>('other');
  protected readonly link = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirming = signal(false);
  private readonly tried = signal(false);

  protected readonly nameError = computed(() =>
    this.tried() && !this.name().trim() ? 'Write a name' : null,
  );
  protected readonly linkError = computed(() => {
    const link = this.link().trim();
    return this.tried() && link && !LINK.test(link)
      ? 'Start the link with https://'
      : null;
  });

  protected readonly pricesNewestFirst = computed(() =>
    [...(this.item()?.prices ?? [])].reverse(),
  );

  protected readonly chart = computed(() => {
    const item = this.item();
    if (!item || item.prices.length < 2) return null;
    const series: UiChartSeries[] = [
      {
        id: item.name,
        label: item.name,
        color: 'var(--viz-1)',
        values: item.prices.map((p) => p.price),
      },
    ];
    return {
      series,
      categories: item.prices.map((p) => monthText(p.date, true)),
      title: (i: number) =>
        `${dateText(item.prices[i]?.date)} · ${item.prices[i]?.merchant ?? ''}`,
    };
  });

  constructor() {
    // A fresh form each time it opens on an item.
    effect(() => {
      const item = this.item();
      if (!this.open() || !item) return;
      untracked(() => {
        this.name.set(item.name);
        this.category.set(item.category);
        this.link.set(item.link ?? '');
        this.error.set(null);
        this.confirming.set(false);
        this.tried.set(false);
      });
    });
  }

  protected categoryLabel(c: string): string {
    return GROCERY_CATEGORY_LABELS[c as GroceryItemCategory] ?? c;
  }

  protected save(item: GroceryItemStatsDto): void {
    this.tried.set(true);
    if (!item.id || this.nameError() || this.linkError()) return;
    this.run(
      this.api.updateItem(item.id, {
        name: this.name().trim(),
        category: this.category() as GroceryItemCategory,
        link: this.link().trim() || null,
      }),
      'Could not save it.',
      true,
    );
  }

  protected remove(item: GroceryItemStatsDto): void {
    if (item.id)
      this.run(this.api.removeItem(item.id), 'Could not remove it.', true);
  }

  protected uploadPhoto(item: GroceryItemStatsDto, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !item.id) return;
    if (!(UPLOAD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      this.error.set('Pick a PNG, JPEG, WebP or GIF image.');
      return;
    }
    if (file.size > UPLOAD_IMAGE_MAX_BYTES) {
      this.error.set(`A photo can be at most ${this.imageMaxMb} MB.`);
      return;
    }
    this.run(
      this.api.uploadItemImage(item.id, file),
      'That photo did not upload. Is the object storage running?',
    );
  }

  protected removePhoto(item: GroceryItemStatsDto): void {
    if (item.id)
      this.run(this.api.removeItemImage(item.id), 'Could not remove it.');
  }

  private run(
    call: Observable<unknown>,
    fallback: string,
    close = false,
  ): void {
    this.busy.set(true);
    this.error.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        if (close) this.open.set(false);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(errorText(error, fallback, SERVICE));
      },
    });
  }
}
