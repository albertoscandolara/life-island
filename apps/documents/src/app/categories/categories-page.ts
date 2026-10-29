import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type {
  ApproveSuggestionRequest,
  CategorySuggestionDto,
  CategoryTemplate,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiFormField,
  UiIcon,
  UiInput,
  UiPageHeader,
} from '@life-island/design-system';
import { firstValueFrom } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';

interface Draft {
  id: string;
  title: string;
  description: string;
  template: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as {
      message?: string;
      issues?: { path: string; message: string }[];
    } | null;
    if (body?.issues?.length)
      return body.issues
        .map(
          (issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
        )
        .join('; ');
    if (typeof body?.message === 'string') return body.message;
  }
  return 'The request failed. Try again.';
}

/** Only the fields you changed are sent, so an untouched suggestion is saved as proposed. */
export function editsOf(
  suggestion: CategorySuggestionDto,
  draft: Draft,
): ApproveSuggestionRequest {
  const edits: ApproveSuggestionRequest = {};
  if (draft.id.trim() !== suggestion.categoryId) edits.id = draft.id.trim();
  if (draft.title.trim() !== suggestion.title) edits.title = draft.title.trim();
  if (draft.description.trim() !== suggestion.description)
    edits.description = draft.description.trim();
  const template = JSON.parse(draft.template) as CategoryTemplate;
  if (JSON.stringify(template) !== JSON.stringify(suggestion.template))
    edits.template = template;
  return edits;
}

/**
 * The category taxonomy: AI suggestions waiting for your decision, and the
 * categories in use with their extraction templates. An approved suggestion
 * becomes a category at once and is assigned to the documents that proposed it.
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
    UiEmptyState,
    UiFormField,
    UiIcon,
    UiInput,
    UiPageHeader,
  ],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.css',
})
export class CategoriesPage {
  private readonly api = inject(IngestionApi);

  protected readonly suggestions = rxResource({
    stream: () => this.api.suggestions({ status: 'PENDING' }),
  });
  protected readonly categories = rxResource({
    stream: () => this.api.categories(),
  });
  protected readonly pending = computed(() => this.suggestions.value() ?? []);

  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<Draft>({
    id: '',
    title: '',
    description: '',
    template: '',
  });
  protected readonly busy = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly notice = signal('');

  protected edit(suggestion: CategorySuggestionDto): void {
    this.editing.set(suggestion.id);
    this.draft.set({
      id: suggestion.categoryId,
      title: suggestion.title,
      description: suggestion.description,
      template: JSON.stringify(suggestion.template, null, 2),
    });
  }

  protected updateDraft(key: keyof Draft, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }

  protected async approve(suggestion: CategorySuggestionDto): Promise<void> {
    let edits: ApproveSuggestionRequest = {};
    if (this.editing() === suggestion.id) {
      try {
        edits = editsOf(suggestion, this.draft());
      } catch {
        this.setError(suggestion.id, 'The template is not valid JSON.');
        return;
      }
    }
    await this.run(suggestion, async () => {
      const approved = await firstValueFrom(
        this.api.approveSuggestion(suggestion.id, edits),
      );
      this.notice.set(
        `${approved.title} is now a category${approved.uploadIds.length ? ` and was added to ${approved.uploadIds.length} document${approved.uploadIds.length === 1 ? '' : 's'}` : ''}.`,
      );
    });
  }

  protected async reject(suggestion: CategorySuggestionDto): Promise<void> {
    await this.run(suggestion, async () => {
      await firstValueFrom(this.api.rejectSuggestion(suggestion.id));
      this.notice.set(
        `${suggestion.title} was rejected; it will not be suggested again.`,
      );
    });
  }

  private async run(
    suggestion: CategorySuggestionDto,
    action: () => Promise<void>,
  ): Promise<void> {
    this.busy.set(suggestion.id);
    this.setError(suggestion.id, '');
    try {
      await action();
      this.editing.set(null);
      this.suggestions.reload();
      this.categories.reload();
    } catch (error) {
      this.setError(suggestion.id, errorMessage(error));
    } finally {
      this.busy.set(null);
    }
  }

  private setError(id: string, message: string): void {
    this.errors.update((errors) => ({ ...errors, [id]: message }));
  }
}
