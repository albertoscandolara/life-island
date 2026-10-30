import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {
  CategoryDto,
  CategorySuggestionDto,
  CategoryTemplate,
  UpdateCategoryRequest,
  UpdateSuggestionRequest,
} from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiCard,
  UiCellDef,
  UiConfirmDialog,
  UiFormField,
  UiIcon,
  UiInput,
  UiPageHeader,
  UiTable,
  type UiTableColumn,
} from '@life-island/design-system';
import { firstValueFrom } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { CategoryStore, errorMessage } from './category-store';

export interface Draft {
  id: string;
  title: string;
  description: string;
  template: string;
}

type Editing =
  | { kind: 'new' }
  | { kind: 'confirmed'; category: CategoryDto }
  | { kind: 'suggested'; suggestion: CategorySuggestionDto };

type Deleting =
  | { kind: 'confirmed'; category: CategoryDto }
  | { kind: 'suggested'; suggestion: CategorySuggestionDto };

const EMPTY_TEMPLATE: CategoryTemplate = { fields: [] };

function draftOf(
  id: string,
  title: string,
  description: string,
  template: CategoryTemplate,
): Draft {
  return {
    id,
    title,
    description,
    template: JSON.stringify(template, null, 2),
  };
}

/** Only the fields you changed are sent, so an untouched value stays as it is. */
export function editsOf(
  original: {
    id: string;
    title: string;
    description: string;
    template: CategoryTemplate;
  },
  draft: Draft,
): UpdateSuggestionRequest {
  const edits: UpdateSuggestionRequest = {};
  if (draft.id.trim() !== original.id) edits.id = draft.id.trim();
  if (draft.title.trim() !== original.title) edits.title = draft.title.trim();
  if (draft.description.trim() !== original.description)
    edits.description = draft.description.trim();
  const template = JSON.parse(draft.template) as CategoryTemplate;
  if (JSON.stringify(template) !== JSON.stringify(original.template))
    edits.template = template;
  return edits;
}

/**
 * Manage the categories: the confirmed ones the AI assigns, and the ones it
 * suggested, which wait for you. Confirming a suggestion makes it a category
 * and adds it to the documents that suggested it; deleting a category takes it
 * off every document.
 */
@Component({
  selector: 'app-categories-page',
  host: { 'data-character': 'ptera' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiAlert,
    UiButton,
    UiCard,
    UiCellDef,
    UiConfirmDialog,
    UiFormField,
    UiIcon,
    UiInput,
    UiPageHeader,
    UiTable,
  ],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.css',
})
export class CategoriesPage {
  private readonly api = inject(IngestionApi);
  protected readonly store = inject(CategoryStore);

  protected readonly confirmed = computed(
    () => this.store.confirmed.value() ?? [],
  );
  protected readonly suggested = computed(
    () => this.store.suggested.value() ?? [],
  );

  protected readonly confirmedColumns: UiTableColumn[] = [
    { key: 'id', header: 'Id', width: '12rem' },
    { key: 'title', header: 'Title', width: '12rem' },
    { key: 'description', header: 'Description' },
    { key: 'fields', header: 'Fields', width: '6rem' },
    { key: 'actions', header: 'Actions', align: 'end', width: '7rem' },
  ];
  protected readonly suggestedColumns: UiTableColumn[] = [
    { key: 'id', header: 'Id', width: '12rem' },
    { key: 'title', header: 'Title', width: '12rem' },
    { key: 'description', header: 'Description' },
    { key: 'documents', header: 'Documents', width: '7rem' },
    { key: 'actions', header: 'Actions', align: 'end', width: '14rem' },
  ];

  protected readonly editing = signal<Editing | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly draft = signal<Draft>(draftOf('', '', '', EMPTY_TEMPLATE));
  protected readonly editorError = signal('');

  protected readonly deleting = signal<Deleting | null>(null);
  protected readonly deleteOpen = signal(false);

  /** Id of the suggestion being confirmed, or of the dialog action running. */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly editorHeading = computed(() => {
    const editing = this.editing();
    if (!editing || editing.kind === 'new') return 'New category';
    return editing.kind === 'confirmed'
      ? `Edit ${editing.category.title}`
      : `Edit suggestion ${editing.suggestion.title}`;
  });

  protected fieldList(template: CategoryTemplate): string {
    return template.fields.map((field) => field.label).join(', ') || 'None';
  }

  protected startNew(): void {
    this.openEditor({ kind: 'new' }, draftOf('', '', '', EMPTY_TEMPLATE));
  }

  protected editConfirmed(category: CategoryDto): void {
    this.openEditor(
      { kind: 'confirmed', category },
      draftOf(
        category.id,
        category.title,
        category.description,
        category.template,
      ),
    );
  }

  protected editSuggested(suggestion: CategorySuggestionDto): void {
    this.openEditor(
      { kind: 'suggested', suggestion },
      draftOf(
        suggestion.categoryId,
        suggestion.title,
        suggestion.description,
        suggestion.template,
      ),
    );
  }

  protected updateDraft(key: keyof Draft, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected async save(): Promise<void> {
    const editing = this.editing();
    if (!editing) return;
    const draft = this.draft();
    let template: CategoryTemplate;
    try {
      template = JSON.parse(draft.template) as CategoryTemplate;
    } catch {
      this.editorError.set('The fields are not valid JSON.');
      return;
    }
    this.busy.set('editor');
    this.editorError.set('');
    try {
      if (editing.kind === 'new') {
        const created = await firstValueFrom(
          this.api.createCategory({
            id: draft.id.trim(),
            title: draft.title.trim(),
            description: draft.description.trim(),
            template,
          }),
        );
        this.notice.set(`${created.title} was added.`);
      } else if (editing.kind === 'confirmed') {
        // The id of a confirmed category is fixed (documents refer to it).
        const edits: UpdateCategoryRequest = editsOf(editing.category, {
          ...draft,
          id: editing.category.id,
        });
        await firstValueFrom(
          this.api.updateCategory(editing.category.id, edits),
        );
        this.notice.set(`${draft.title.trim()} was saved.`);
      } else {
        const { suggestion } = editing;
        await firstValueFrom(
          this.api.updateSuggestion(
            suggestion.id,
            editsOf({ ...suggestion, id: suggestion.categoryId }, draft),
          ),
        );
        this.notice.set(`The suggestion ${draft.title.trim()} was saved.`);
      }
      this.editorOpen.set(false);
      this.store.reload();
    } catch (error) {
      this.editorError.set(errorMessage(error));
    } finally {
      this.busy.set(null);
    }
  }

  /** Makes a suggestion a category; the documents that suggested it get it. */
  protected async confirm(suggestion: CategorySuggestionDto): Promise<void> {
    this.busy.set(suggestion.id);
    this.error.set('');
    try {
      const approved = await firstValueFrom(
        this.api.approveSuggestion(suggestion.id),
      );
      const count = approved.uploadIds.length;
      this.notice.set(
        `${approved.title} is now a confirmed category${count ? ` and was added to ${count} document${count === 1 ? '' : 's'}` : ''}.`,
      );
      this.store.reload();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected askDelete(deleting: Deleting): void {
    this.deleting.set(deleting);
    this.error.set('');
    this.deleteOpen.set(true);
  }

  protected deleteHeading(): string {
    const deleting = this.deleting();
    if (!deleting) return '';
    return deleting.kind === 'confirmed'
      ? `Delete ${deleting.category.title}?`
      : `Delete the suggestion ${deleting.suggestion.title}?`;
  }

  protected async remove(): Promise<void> {
    const deleting = this.deleting();
    if (!deleting) return;
    this.busy.set('delete');
    this.error.set('');
    try {
      if (deleting.kind === 'confirmed') {
        await firstValueFrom(this.api.deleteCategory(deleting.category.id));
        this.notice.set(`${deleting.category.title} was deleted.`);
      } else {
        await firstValueFrom(this.api.rejectSuggestion(deleting.suggestion.id));
        this.notice.set(
          `The suggestion ${deleting.suggestion.title} was deleted; it will not be suggested again.`,
        );
      }
      this.deleteOpen.set(false);
      this.store.reload();
    } catch (error) {
      this.error.set(errorMessage(error));
      this.deleteOpen.set(false);
    } finally {
      this.busy.set(null);
    }
  }

  private openEditor(editing: Editing, draft: Draft): void {
    this.editing.set(editing);
    this.draft.set(draft);
    this.editorError.set('');
    this.editorOpen.set(true);
  }
}
