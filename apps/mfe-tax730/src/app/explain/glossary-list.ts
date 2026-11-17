import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { UiInput } from '@life-island/design-system';
import { GLOSSARY } from './glossary';

const fold = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * The words of the tax return, in English and Italian, searchable. Reading
 * matter: a topic of the page's guide.
 */
@Component({
  selector: 'tax-glossary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiInput],
  template: `
    <input
      uiInput
      type="search"
      class="search"
      placeholder="e.g. credito, F24, incapienza"
      aria-label="Search the glossary"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
    />
    <dl class="terms">
      @for (t of terms(); track t.term) {
        <div class="term">
          <dt>
            <span class="term__en">{{ t.term }}</span>
            @if (t.italian !== t.term) {
              <span class="term__it">{{ t.italian }}</span>
            }
          </dt>
          <dd>
            {{ t.explain }}
            @if (t.where) {
              <span class="term__where">On the return: {{ t.where }}</span>
            }
          </dd>
        </div>
      } @empty {
        <p class="empty">No word matches “{{ query() }}”.</p>
      }
    </dl>
  `,
  styles: `
    :host {
      display: block;
    }
    .search {
      width: 100%;
      margin-bottom: var(--space-4);
    }
    .terms {
      display: grid;
      margin: 0;
    }
    .term {
      display: grid;
      grid-template-columns: minmax(8rem, 12rem) 1fr;
      gap: var(--space-1) var(--space-4);
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .term dt {
      display: grid;
      align-content: start;
    }
    .term__en {
      color: var(--text-primary);
      font-weight: 600;
    }
    .term__it {
      color: var(--text-muted);
      font-size: var(--text-xs);
      font-style: italic;
    }
    .term dd {
      margin: 0;
    }
    .term__where {
      display: block;
      margin-top: var(--space-1);
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .empty {
      color: var(--text-muted);
    }
    @media (max-width: 640px) {
      .term {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class GlossaryList {
  protected readonly query = signal('');
  protected readonly terms = computed(() => {
    const q = fold(this.query().trim());
    if (!q) return GLOSSARY;
    return GLOSSARY.filter((t) =>
      fold(`${t.term} ${t.italian} ${t.explain} ${t.where ?? ''}`).includes(q),
    );
  });
}
