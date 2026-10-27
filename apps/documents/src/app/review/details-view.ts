import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface Field {
  label: string;
  kind: 'value' | 'object' | 'table' | 'list';
  value?: string;
  fields?: Field[];
  columns?: string[];
  headers?: string[];
  rows?: string[][];
}

/** `purchasedAt` → `Purchased at`, `vatNumber` → `Vat number`. */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatValue(value: Json): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
  ) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The part of a JSON Schema used for ordering: property order, and item schemas for arrays. */
export interface SchemaShape {
  properties?: Record<string, SchemaShape>;
  items?: SchemaShape;
}

/** Keys in the order the target schema declares them (the database does not keep key order). */
function orderedKeys(keys: string[], schema?: SchemaShape): string[] {
  const declared = Object.keys(schema?.properties ?? {});
  const rank = (key: string) =>
    declared.includes(key) ? declared.indexOf(key) : declared.length;
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

export function toFields(
  value: { [key: string]: Json },
  schema?: SchemaShape,
): Field[] {
  return orderedKeys(Object.keys(value), schema).map((key): Field => {
    const item = value[key];
    const itemSchema = schema?.properties?.[key];
    const label = humanize(key);
    if (Array.isArray(item)) {
      if (item.length > 0 && item.every(isObject)) {
        const columns = orderedKeys(
          [...new Set(item.flatMap((row) => Object.keys(row as object)))],
          itemSchema?.items,
        );
        return {
          label,
          kind: 'table',
          columns,
          headers: columns.map(humanize),
          rows: item.map((row) =>
            columns.map((column) =>
              formatValue((row as { [key: string]: Json })[column] ?? null),
            ),
          ),
        };
      }
      return {
        label,
        kind: 'list',
        value: item.map(formatValue).join(', ') || '–',
      };
    }
    if (isObject(item))
      return { label, kind: 'object', fields: toFields(item, itemSchema) };
    return { label, kind: 'value', value: formatValue(item) };
  });
}

/**
 * Renders any details JSON readably, in the order of the target schema: values as a definition list, nested
 * objects as groups, arrays of objects (receipt items...) as a table. Works for
 * every target schema, so a new category needs no UI change.
 */
@Component({
  selector: 'app-details-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #fieldList let-fields>
      <dl class="fields">
        @for (field of fields; track field.label) {
          @switch (field.kind) {
            @case ('object') {
              <div class="group">
                <dt class="group__title">{{ field.label }}</dt>
                <dd>
                  <ng-container
                    *ngTemplateOutlet="
                      fieldList;
                      context: { $implicit: field.fields }
                    "
                  />
                </dd>
              </div>
            }
            @case ('table') {
              <div class="group">
                <dt class="group__title">
                  {{ field.label }} ({{ field.rows.length }})
                </dt>
                <dd class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        @for (header of field.headers; track $index) {
                          <th scope="col">{{ header }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of field.rows; track $index) {
                        <tr>
                          @for (cell of row; track $index) {
                            <td>{{ cell }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </dd>
              </div>
            }
            @default {
              <div class="pair">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              </div>
            }
          }
        }
      </dl>
    </ng-template>

    @if (fields().length) {
      <ng-container
        *ngTemplateOutlet="fieldList; context: { $implicit: fields() }"
      />
    } @else {
      <p class="empty">No details were extracted.</p>
    }
  `,
  imports: [NgTemplateOutlet],
  styleUrl: './details-view.css',
})
export class DetailsView {
  readonly details = input<unknown>(null);
  /** JSON Schema of the record's target, from the catalog; used to order the fields. */
  readonly schema = input<SchemaShape | undefined>(undefined);
  protected readonly fields = computed(() => {
    const details = this.details() as Json;
    return isObject(details) ? toFields(details, this.schema()) : [];
  });
}
