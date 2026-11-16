import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { UiCard, UiInput } from '@life-island/design-system';
import { GLOSSARY } from './glossary';

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** The words of the tax return, in English and Italian, searchable. */
@Component({
  selector: 'tax-glossary-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiInput],
  template: `
    <ui-card heading="Glossary">
      <p class="lead">
        The words on your return, in plain language. Search in English or
        Italian.
      </p>
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
          <p class="muted">No word matches “{{ query() }}”.</p>
        }
      </dl>
    </ui-card>
  `,
  styleUrls: ['./explain.css'],
  styles: `
    .search {
      max-width: 24rem;
      margin-bottom: var(--space-4);
    }
    .terms {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: var(--space-3);
      margin: 0;
    }
    .term {
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .term dt {
      display: grid;
      margin-bottom: var(--space-1);
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
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .term__where {
      display: block;
      margin-top: var(--space-1);
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
  `,
})
export class GlossaryCard {
  protected readonly query = signal('');
  protected readonly terms = computed(() => {
    const q = fold(this.query().trim());
    if (!q) return GLOSSARY;
    return GLOSSARY.filter((t) =>
      fold(`${t.term} ${t.italian} ${t.explain} ${t.where ?? ''}`).includes(q),
    );
  });
}
