import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from '@angular/core';
import {
  UiButton,
  UiFormField,
  UiIcon,
  UiInput,
} from '@life-island/design-system';
import {
  emptyValue,
  getAt,
  inputKind,
  inputText,
  isObject,
  orderedProperties,
  parseInput,
  removeAt,
  setAt,
  type JsonSchema,
  type JsonValue,
  type Path,
} from './details-form-model';
import { humanize } from './details-view';

/**
 * Edits a record's details as a form generated from its target's JSON Schema:
 * text, number, date and choice inputs for values, groups for objects, an
 * editable table for lists of objects (receipt items). Works for every target,
 * so a new module needs no form code.
 */
@Component({
  selector: 'app-details-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, UiButton, UiFormField, UiIcon, UiInput],
  template: `
    <ng-template #control let-schema="schema" let-path="path" let-label="label">
      @switch (kind(schema, path)) {
        @case ('select') {
          <select
            class="ui-input"
            [attr.aria-label]="label"
            [disabled]="disabled()"
            (change)="set(path, schema, text($event))"
          >
            <option value="" [selected]="!textAt(path, schema)">–</option>
            @for (option of schema.enum; track option) {
              <option
                [value]="option"
                [selected]="textAt(path, schema) === '' + option"
              >
                {{ humanize('' + option) }}
              </option>
            }
          </select>
        }
        @case ('boolean') {
          <select
            class="ui-input"
            [attr.aria-label]="label"
            [disabled]="disabled()"
            (change)="set(path, schema, text($event))"
          >
            <option value="" [selected]="!textAt(path, schema)">–</option>
            <option value="true" [selected]="textAt(path, schema) === 'true'">
              Yes
            </option>
            <option value="false" [selected]="textAt(path, schema) === 'false'">
              No
            </option>
          </select>
        }
        @case ('textarea') {
          <textarea
            uiInput
            rows="3"
            [attr.aria-label]="label"
            [value]="textAt(path, schema)"
            [disabled]="disabled()"
            (input)="set(path, schema, text($event))"
          ></textarea>
        }
        @default {
          <input
            uiInput
            [type]="htmlType(schema, path)"
            [attr.step]="htmlType(schema, path) === 'number' ? 'any' : null"
            [attr.aria-label]="label"
            [value]="textAt(path, schema)"
            [disabled]="disabled()"
            (input)="set(path, schema, text($event))"
          />
        }
      }
    </ng-template>

    <ng-template #node let-schema="schema" let-path="path">
      <div class="grid">
        @for (key of keys(schema, path); track key) {
          @let child = schema.properties?.[key] ?? {};
          @let childPath = path.concat([key]);
          @let label = humanize(key) + (isRequired(schema, key) ? ' *' : '');
          @if (child.type === 'object') {
            <fieldset class="group">
              <legend>{{ label }}</legend>
              <ng-container
                *ngTemplateOutlet="
                  node;
                  context: { schema: child, path: childPath }
                "
              />
            </fieldset>
          } @else if (
            child.type === 'array' && child.items?.type === 'object'
          ) {
            <fieldset class="group group--wide">
              <legend>{{ label }} ({{ rows(childPath).length }})</legend>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      @for (column of columns(child.items); track column) {
                        <th scope="col">
                          {{ humanize(column)
                          }}{{ isRequired(child.items, column) ? ' *' : '' }}
                        </th>
                      }
                      <th scope="col">
                        <span class="ui-visually-hidden">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (
                      row of rows(childPath);
                      track $index;
                      let i = $index
                    ) {
                      <tr>
                        @for (column of columns(child.items); track column) {
                          <td>
                            <ng-container
                              *ngTemplateOutlet="
                                control;
                                context: {
                                  schema: child.items.properties[column],
                                  path: childPath.concat([i, column]),
                                  label: humanize(column) + ' ' + (i + 1),
                                }
                              "
                            />
                          </td>
                        }
                        <td>
                          <button
                            uiButton
                            variant="ghost"
                            size="sm"
                            [iconOnly]="true"
                            type="button"
                            [disabled]="disabled()"
                            [attr.aria-label]="'Remove row ' + (i + 1)"
                            (click)="remove(childPath.concat([i]))"
                          >
                            <ui-icon name="trash" [size]="16" />
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <button
                uiButton
                variant="secondary"
                size="sm"
                type="button"
                [disabled]="disabled()"
                (click)="add(childPath, child.items)"
              >
                <ui-icon name="plus" [size]="16" /> Add row
              </button>
            </fieldset>
          } @else if (child.type === 'array') {
            <ui-form-field [label]="label" hint="One per line">
              <textarea
                uiInput
                rows="2"
                [value]="listText(childPath)"
                [disabled]="disabled()"
                (input)="setList(childPath, child.items ?? {}, text($event))"
              ></textarea>
            </ui-form-field>
          } @else {
            <ui-form-field [label]="label" [hint]="child.description ?? ''">
              <ng-container
                *ngTemplateOutlet="
                  control;
                  context: { schema: child, path: childPath, label: label }
                "
              />
            </ui-form-field>
          }
        }
      </div>
    </ng-template>

    <ng-container
      *ngTemplateOutlet="node; context: { schema: schema(), path: [] }"
    />
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: var(--space-3);
    }
    .group {
      display: grid;
      gap: var(--space-2);
      grid-column: 1 / -1;
      margin: 0;
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    legend {
      padding: 0 var(--space-1);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    th,
    td {
      padding: var(--space-1);
      text-align: start;
      vertical-align: top;
    }
    th {
      color: var(--text-secondary);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    td .ui-input {
      min-width: 6rem;
    }
  `,
})
export class DetailsForm {
  readonly schema = input.required<JsonSchema>();
  readonly value = model<JsonValue | undefined>(undefined);
  readonly disabled = input(false);

  protected readonly humanize = humanize;

  protected keys(schema: JsonSchema, path: Path): string[] {
    return orderedProperties(schema, getAt(this.value(), path));
  }

  protected isRequired(schema: JsonSchema, key: string): boolean {
    return !!schema.required?.includes(key);
  }

  protected columns(schema: JsonSchema): string[] {
    return Object.keys(schema.properties ?? {});
  }

  protected rows(path: Path): JsonValue[] {
    const list = getAt(this.value(), path);
    return Array.isArray(list) ? list : [];
  }

  protected kind(schema: JsonSchema, path: Path): string {
    return inputKind(schema, String(path[path.length - 1] ?? ''));
  }

  protected htmlType(schema: JsonSchema, path: Path): string {
    const kind = this.kind(schema, path);
    if (kind === 'datetime') return 'datetime-local';
    return kind === 'number' || kind === 'date' ? kind : 'text';
  }

  protected textAt(path: Path, schema: JsonSchema): string {
    return inputText(getAt(this.value(), path), schema);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected set(path: Path, schema: JsonSchema, text: string): void {
    this.value.update((value) => setAt(value, path, parseInput(text, schema)));
  }

  protected listText(path: Path): string {
    return this.rows(path)
      .map((item) => (isObject(item) ? JSON.stringify(item) : String(item)))
      .join('\n');
  }

  protected setList(path: Path, items: JsonSchema, text: string): void {
    const list = text
      .split('\n')
      .map((line) => parseInput(line, items))
      .filter((item): item is JsonValue => item !== undefined);
    this.value.update((value) => setAt(value, path, list));
  }

  protected add(path: Path, items: JsonSchema): void {
    this.value.update((value) =>
      setAt(value, path, [...this.rows(path), emptyValue(items)]),
    );
  }

  protected remove(path: Path): void {
    this.value.update((value) => removeAt(value, path));
  }
}
