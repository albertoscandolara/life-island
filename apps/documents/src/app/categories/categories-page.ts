import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  CategoryDto,
  CategorySuggestionDto,
  CategoryTemplate,
  DeleteChildrenOption,
  DeleteDocumentsOption,
  UpdateCategoryRequest,
  UpdateSuggestionRequest,
} from '@life-island/contracts';
import {
  CATEGORY_DIMENSION_LABELS,
  CATEGORY_DIMENSIONS,
  type CategoryDimension,
} from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiCellDef,
  UiConfirmDialog,
  UiDropdown,
  UiEmptyState,
  UiFormField,
  UiIcon,
  UiInput,
  UiPageHeader,
  UiTable,
  type UiOption,
  type UiTableColumn,
} from '@life-island/design-system';
import { firstValueFrom } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { categoryRows, textMatch, type CategoryRow } from './category-rows';
import { CategoryStore, errorMessage } from './category-store';

export interface Draft {
  id: string;
  title: string;
  description: string;
  template: string;
}

type Editing =
  | { kind: 'new'; parentId: string | null }
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
 * Where `category` may move: anywhere but itself and its own subtree, under
 * a parent of the same dimension (a general category may go anywhere and
 * takes its new parent's dimension).
 */
export function parentCandidates(
  categories: readonly CategoryDto[],
  category: CategoryDto | null,
  excluded: ReadonlySet<string>,
): CategoryDto[] {
  return categories.filter(
    (candidate) =>
      !excluded.has(candidate.id) &&
      (!category ||
        category.dimension === null ||
        candidate.dimension === category.dimension),
  );
}

const dimensionLabel = (dimension: CategoryDimension | null) =>
  dimension ? CATEGORY_DIMENSION_LABELS[dimension] : 'General';

/**
 * Manage the categories: the hierarchy of confirmed ones the AI assigns, and
 * the ones it suggested, which wait for you. Select a category in the tree to
 * see where it sits (its path from the top, its children and everything
 * below), move it under another parent or to the top level, edit or delete it.
 */
@Component({
  selector: 'app-categories-page',
  host: { 'data-character': 'ptera' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCellDef,
    UiConfirmDialog,
    UiDropdown,
    UiEmptyState,
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly confirmed = computed(
    () => this.store.confirmed.value() ?? [],
  );
  protected readonly suggested = computed(
    () => this.store.suggested.value() ?? [],
  );
  protected readonly tree = this.store.hierarchy;

  protected readonly suggestedColumns: UiTableColumn[] = [
    { key: 'id', header: 'Id', width: '12rem' },
    { key: 'title', header: 'Title', width: '12rem' },
    { key: 'description', header: 'Description' },
    { key: 'documents', header: 'Documents', width: '7rem' },
    { key: 'actions', header: 'Actions', align: 'end', width: '14rem' },
  ];

  // --- Tree and selection -------------------------------------------------

  /** The selected category id, kept in the URL so a category can be linked to. */
  protected readonly selectedId = signal<string | null>(
    this.route.snapshot.queryParamMap.get('category'),
  );
  protected readonly search = signal('');
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly showDescendants = signal(false);

  protected readonly rows = computed<CategoryRow[]>(() => {
    const text = this.search().trim();
    return categoryRows(
      this.tree(),
      this.expanded(),
      text ? textMatch(text) : undefined,
    );
  });

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (this.tree().get(id) ?? null) : null;
  });
  protected readonly ancestors = computed(() => {
    const id = this.selectedId();
    return id ? this.tree().ancestors(id) : [];
  });
  protected readonly children = computed(() => {
    const id = this.selectedId();
    return id ? this.tree().children(id) : [];
  });
  /** Everything below the selected category, with depths relative to it. */
  protected readonly descendants = computed(() => {
    const selected = this.selected();
    if (!selected) return [];
    const base = this.ancestors().length + 1;
    return this.tree()
      .descendants(selected.id)
      .map((category) => ({
        category,
        depth: this.tree().ancestors(category.id).length - base,
      }));
  });

  /** Where the selected category can move: never under itself or its descendants. */
  protected readonly parentOptions = computed<UiOption<string>[]>(() => {
    const selected = this.selected();
    if (!selected) return [];
    const excluded = new Set([
      selected.id,
      ...this.tree()
        .descendants(selected.id)
        .map((category) => category.id),
    ]);
    return this.optionsFor(selected, excluded);
  });

  protected readonly dimensionOptions: UiOption<CategoryDimension>[] =
    CATEGORY_DIMENSIONS.map((value) => ({
      value,
      label: CATEGORY_DIMENSION_LABELS[value],
    }));
  protected readonly dimensionLabel = dimensionLabel;

  // --- Editing ------------------------------------------------------------

  protected readonly editing = signal<Editing | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly draft = signal<Draft>(draftOf('', '', '', EMPTY_TEMPLATE));
  protected readonly draftParent = signal<string | null>(null);
  protected readonly draftDimension = signal<CategoryDimension | null>(null);
  protected readonly editorError = signal('');

  /** Parents the category in the editor can have. */
  protected readonly draftParentOptions = computed<UiOption<string>[]>(() => {
    const editing = this.editing();
    if (!editing || editing.kind === 'suggested') return [];
    if (editing.kind === 'new') return this.optionsFor(null, new Set());
    const { category } = editing;
    return this.optionsFor(
      category,
      new Set([
        category.id,
        ...this.tree()
          .descendants(category.id)
          .map((item) => item.id),
      ]),
    );
  });
  /** Under a parent, the dimension is the parent's. */
  protected readonly inheritedDimension = computed(() => {
    const parentId = this.draftParent();
    return parentId ? (this.tree().get(parentId)?.dimension ?? null) : null;
  });

  // --- Deleting -----------------------------------------------------------

  protected readonly deleting = signal<Deleting | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleteChildren =
    signal<DeleteChildrenOption>('MOVE_TO_PARENT');
  protected readonly deleteDocuments = signal<DeleteDocumentsOption>('REMOVE');
  protected readonly deletingChildren = computed(() => {
    const deleting = this.deleting();
    return deleting?.kind === 'confirmed'
      ? this.tree().children(deleting.category.id)
      : [];
  });
  protected readonly deletingParent = computed(() => {
    const deleting = this.deleting();
    return deleting?.kind === 'confirmed' && deleting.category.parentId
      ? (this.tree().get(deleting.category.parentId) ?? null)
      : null;
  });

  /** Bumped after every move or dimension change, to redraw the controls from the saved state. */
  protected readonly revision = signal(0);

  /** Id of the suggestion being confirmed, or of the action running. */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly editorHeading = computed(() => {
    const editing = this.editing();
    if (!editing) return '';
    if (editing.kind === 'new')
      return editing.parentId
        ? `New subcategory of ${this.store.titleOf(editing.parentId)}`
        : 'New category';
    return editing.kind === 'confirmed'
      ? `Edit ${editing.category.title}`
      : `Edit suggestion ${editing.suggestion.title}`;
  });

  constructor() {
    // Keep the selection in the URL, and open the tree down to it.
    effect(() => {
      const id = this.selectedId();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { category: id ?? undefined },
        replaceUrl: true,
      });
    });
    effect(() => {
      const id = this.selectedId();
      const path = id ? this.tree().ancestors(id) : [];
      if (path.some((category) => !this.expanded().has(category.id)))
        this.expanded.update(
          (ids) => new Set([...ids, ...path.map((category) => category.id)]),
        );
    });
  }

  protected fieldList(template: CategoryTemplate): string {
    return template.fields.map((field) => field.label).join(', ') || 'None';
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    this.showDescendants.set(false);
  }

  protected toggleExpanded(id: string): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected expandAll(): void {
    this.expanded.set(
      new Set(
        this.confirmed()
          .filter((category) => this.tree().children(category.id).length)
          .map((category) => category.id),
      ),
    );
  }

  protected collapseAll(): void {
    this.expanded.set(new Set());
  }

  /** Arrow keys move through the tree; left and right collapse and expand. */
  protected onTreeKeydown(event: KeyboardEvent, row: CategoryRow): void {
    if (row.kind !== 'category') return;
    const nodes = this.rows().filter((item) => item.kind === 'category');
    const index = nodes.findIndex((item) => item.key === row.key);
    const focus = (target?: CategoryRow) => {
      if (!target) return;
      event.preventDefault();
      this.select(target.key);
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>(`[data-node="${target.key}"]`)
          ?.focus(),
      );
    };
    switch (event.key) {
      case 'ArrowDown':
        return focus(nodes[index + 1]);
      case 'ArrowUp':
        return focus(nodes[index - 1]);
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) {
          event.preventDefault();
          this.toggleExpanded(row.key);
        } else if (row.expanded) focus(nodes[index + 1]);
        return;
      case 'ArrowLeft':
        if (row.expanded) {
          event.preventDefault();
          this.toggleExpanded(row.key);
        } else if (row.category.parentId)
          focus(nodes.find((item) => item.key === row.category.parentId));
        return;
    }
  }

  // --- Parent and dimension, from the details panel ------------------------

  protected async move(
    category: CategoryDto,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === category.parentId) return;
    await this.run('move', async () => {
      await firstValueFrom(this.api.updateCategory(category.id, { parentId }));
      this.notice.set(
        parentId
          ? `${category.title} is now under ${this.store.pathOf(parentId)}.`
          : `${category.title} is now a top-level category.`,
      );
    });
  }

  protected async setDimension(
    category: CategoryDto,
    dimension: CategoryDimension | null,
  ): Promise<void> {
    if (dimension === category.dimension) return;
    await this.run('dimension', async () => {
      await firstValueFrom(this.api.updateCategory(category.id, { dimension }));
      const below = this.tree().descendants(category.id).length;
      this.notice.set(
        `${category.title}${below ? ` and its ${below} subcategor${below === 1 ? 'y' : 'ies'}` : ''} ${below ? 'are' : 'is'} now ${dimension ? CATEGORY_DIMENSION_LABELS[dimension].toLowerCase() : 'general'}.`,
      );
    });
  }

  // --- Editor ---------------------------------------------------------------

  protected startNew(parentId: string | null = null): void {
    this.openEditor(
      { kind: 'new', parentId },
      draftOf('', '', '', EMPTY_TEMPLATE),
      parentId,
      null,
    );
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
      category.parentId,
      category.dimension,
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
      null,
      null,
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
    const parentId = this.draftParent();
    const dimension = parentId ? undefined : this.draftDimension();
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
            parentId,
            dimension: dimension ?? null,
          }),
        );
        this.notice.set(`${created.title} was added.`);
        this.selectedId.set(created.id);
      } else if (editing.kind === 'confirmed') {
        const { category } = editing;
        // The id of a confirmed category is fixed (documents refer to it).
        const edits: UpdateCategoryRequest = editsOf(category, {
          ...draft,
          id: category.id,
        });
        if (parentId !== category.parentId) edits.parentId = parentId;
        if (dimension !== undefined && dimension !== category.dimension)
          edits.dimension = dimension;
        await firstValueFrom(this.api.updateCategory(category.id, edits));
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

  // --- Delete -------------------------------------------------------------

  protected askDelete(deleting: Deleting): void {
    this.deleting.set(deleting);
    this.deleteChildren.set('MOVE_TO_PARENT');
    this.deleteDocuments.set('REMOVE');
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
        const { category } = deleting;
        await firstValueFrom(
          this.api.deleteCategory(category.id, {
            children: this.deletingChildren().length
              ? this.deleteChildren()
              : undefined,
            documents: this.deleteDocuments(),
          }),
        );
        this.notice.set(`${category.title} was deleted.`);
        if (this.selectedId() === category.id)
          this.selectedId.set(category.parentId);
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

  protected radio(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private optionsFor(
    category: CategoryDto | null,
    excluded: ReadonlySet<string>,
  ): UiOption<string>[] {
    // In tree order, so the list reads like the hierarchy.
    const order = this.tree().roots.flatMap((root) => [
      root,
      ...this.tree().descendants(root.id),
    ]);
    return parentCandidates(order, category, excluded).map((candidate) => ({
      value: candidate.id,
      label: this.store.pathOf(candidate.id),
    }));
  }

  private openEditor(
    editing: Editing,
    draft: Draft,
    parentId: string | null,
    dimension: CategoryDimension | null,
  ): void {
    this.editing.set(editing);
    this.draft.set(draft);
    this.draftParent.set(parentId);
    this.draftDimension.set(dimension);
    this.editorError.set('');
    this.editorOpen.set(true);
  }

  private async run(action: string, work: () => Promise<void>): Promise<void> {
    this.busy.set(action);
    this.error.set('');
    try {
      await work();
      this.store.reload();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(null);
      this.revision.update((value) => value + 1);
    }
  }
}
