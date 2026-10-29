import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTransaction, type ServiceDb } from '@life-island/be-common';
import {
  approveSuggestionRequestSchema,
  listSuggestionsQuerySchema,
  updateCategoryRequestSchema,
  type CategoryDto,
  type CategorySuggestionDto,
  type ParseQueueDto,
} from '@life-island/contracts';
import {
  categorySuggestions,
  documentCategories,
  PARSE_QUEUE_ID,
  parseQueue,
  toCategoryDto,
  toParseQueueDto,
  toSuggestionDto,
  uploads,
} from '@life-island/ingestion-db';
import { and, arrayContains, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';

type ListSuggestions = z.output<typeof listSuggestionsQuerySchema>;
type ApproveSuggestion = z.output<typeof approveSuggestionRequestSchema>;
type UpdateCategory = z.output<typeof updateCategoryRequestSchema>;

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string }).code ??
    (error as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
}

/**
 * The category taxonomy and the AI's suggestions for it. The parse worker
 * writes suggestions; only an approval here (or the worker's automatic
 * approval, when configured) turns one into a category.
 */
@Injectable()
export class CategoriesService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async list(): Promise<CategoryDto[]> {
    const rows = await this.svc.db
      .select()
      .from(documentCategories)
      .orderBy(asc(documentCategories.title));
    return rows.map(toCategoryDto);
  }

  async update(id: string, request: UpdateCategory): Promise<CategoryDto> {
    try {
      const [row] = await this.svc.db
        .update(documentCategories)
        .set({
          ...(request.title ? { title: request.title } : {}),
          ...(request.description ? { description: request.description } : {}),
          ...(request.template ? { templateJson: request.template } : {}),
          updatedAt: new Date(),
        })
        .where(eq(documentCategories.id, id))
        .returning();
      if (!row) throw new NotFoundException(`Category ${id} not found`);
      return toCategoryDto(row);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Another category already has this title');
      throw error;
    }
  }

  async listSuggestions(
    query: ListSuggestions,
  ): Promise<CategorySuggestionDto[]> {
    const rows = await this.svc.db
      .select()
      .from(categorySuggestions)
      .where(
        and(
          query.status
            ? eq(categorySuggestions.status, query.status)
            : undefined,
          query.uploadId
            ? arrayContains(categorySuggestions.uploadIds, [query.uploadId])
            : undefined,
        ),
      )
      .orderBy(desc(categorySuggestions.createdAt));
    return rows.map(toSuggestionDto);
  }

  /**
   * Saves the suggestion as a category (with your edits, if any), in one
   * transaction that also assigns it to the documents that suggested it. From
   * the next document on, the worker matches it like any other category.
   */
  async approve(
    suggestionId: string,
    request: ApproveSuggestion,
  ): Promise<CategorySuggestionDto> {
    try {
      return await withTransaction(this.svc.pool, async (client) => {
        const db = drizzle(client);
        const [suggestion] = await db
          .select()
          .from(categorySuggestions)
          .where(eq(categorySuggestions.id, suggestionId))
          .for('update');
        if (!suggestion)
          throw new NotFoundException(`Suggestion ${suggestionId} not found`);
        if (suggestion.status !== 'PENDING')
          throw new ConflictException(
            `This suggestion was already ${suggestion.status.toLowerCase()}`,
          );
        const id = request.id ?? suggestion.categoryId;
        const inserted = await db
          .insert(documentCategories)
          .values({
            id,
            title: request.title ?? suggestion.title,
            description: request.description ?? suggestion.description,
            templateJson: request.template ?? suggestion.templateJson,
          })
          .onConflictDoNothing({ target: documentCategories.id })
          .returning();
        if (!inserted.length)
          throw new ConflictException(
            `A category with id ${id} already exists; approve it under another id or reject it`,
          );
        const [approved] = await db
          .update(categorySuggestions)
          .set({
            status: 'APPROVED',
            approvedCategoryId: id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(categorySuggestions.id, suggestionId))
          .returning();
        if (suggestion.uploadIds.length)
          await client.query(
            `update ingestion.uploads
                set categories = case when $1 = any(categories) then categories
                                      else array_append(categories, $1) end,
                    updated_at = now()
              where id = any($2::uuid[])`,
            [id, suggestion.uploadIds],
          );
        return toSuggestionDto(approved);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'A category with this title already exists',
        );
      throw error;
    }
  }

  async reject(suggestionId: string): Promise<CategorySuggestionDto> {
    const [row] = await this.svc.db
      .update(categorySuggestions)
      .set({
        status: 'REJECTED',
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(categorySuggestions.id, suggestionId),
          eq(categorySuggestions.status, 'PENDING'),
        ),
      )
      .returning();
    if (row) return toSuggestionDto(row);
    const [existing] = await this.svc.db
      .select()
      .from(categorySuggestions)
      .where(eq(categorySuggestions.id, suggestionId));
    if (!existing)
      throw new NotFoundException(`Suggestion ${suggestionId} not found`);
    throw new ConflictException(
      `This suggestion was already ${existing.status.toLowerCase()}`,
    );
  }

  /** The parse queue's state, for the status banner. */
  async queue(): Promise<ParseQueueDto> {
    const [[row], [{ pending }]] = await Promise.all([
      this.svc.db
        .select()
        .from(parseQueue)
        .where(eq(parseQueue.id, PARSE_QUEUE_ID)),
      this.svc.db
        .select({ pending: count() })
        .from(uploads)
        .where(
          inArray(uploads.status, [
            'TO_BE_PARSED',
            'PARSING',
            'PAUSED_QUOTA',
            'PAUSED_RATE_LIMIT',
          ]),
        ),
    ]);
    return toParseQueueDto(row, pending);
  }
}
