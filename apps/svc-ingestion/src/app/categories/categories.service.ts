import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { withTransaction, type ServiceDb } from '@life-island/be-common';
import {
  approveSuggestionRequestSchema,
  approveSuggestionsRequestSchema,
  CATEGORY_DIMENSION_LABELS,
  CategoryHierarchy,
  createCategoryRequestSchema,
  deleteCategoryQuerySchema,
  listSuggestionsQuerySchema,
  updateCategoryRequestSchema,
  updateSuggestionRequestSchema,
  type CategoryDimension,
  type CategoryDto,
  type CategoryHierarchyDto,
  type CategorySuggestionDto,
  type ParseQueueDto,
} from '@life-island/contracts';
import {
  assertWritable,
  bumpTaxonomyVersion,
  categorySuggestions,
  documentCategories,
  enqueueCategoriesChanged,
  enqueueUploadUpdated,
  PARSE_QUEUE_ID,
  parseQueue,
  syncTemplateFields,
  toCategoryDto,
  toParseQueueDto,
  toSuggestionDto,
  uploads,
  type CategoryCounts,
  type CategoryRow,
} from '@life-island/ingestion-db';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  inArray,
  sql,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';

type ListSuggestions = z.output<typeof listSuggestionsQuerySchema>;
type ApproveSuggestion = z.output<typeof approveSuggestionRequestSchema>;
type ApproveSuggestions = z.output<typeof approveSuggestionsRequestSchema>;
type UpdateCategory = z.output<typeof updateCategoryRequestSchema>;
type CreateCategory = z.output<typeof createCategoryRequestSchema>;
type UpdateSuggestion = z.output<typeof updateSuggestionRequestSchema>;
type DeleteCategory = z.output<typeof deleteCategoryQuerySchema>;

/** Serializes every change to the hierarchy, so two moves cannot form a cycle together. */
const HIERARCHY_LOCK = 'ingestion:category-hierarchy';

function dimensionName(dimension: CategoryDimension | null): string {
  return dimension ? CATEGORY_DIMENSION_LABELS[dimension] : 'general';
}

/** A cycle the database trigger caught (the service checks first; this is the safety net). */
function isCycleViolation(error: unknown): boolean {
  const constraint =
    (error as { constraint?: string }).constraint ??
    (error as { cause?: { constraint?: string } }).cause?.constraint;
  return constraint === 'document_categories_no_cycle';
}

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

  /** Every category, with its parent, dimension and document counts. */
  async list(): Promise<CategoryDto[]> {
    const [rows, counts] = await Promise.all([
      this.svc.db
        .select()
        .from(documentCategories)
        .orderBy(asc(documentCategories.title)),
      this.counts(),
    ]);
    return rows.map((row) => toCategoryDto(row, counts.get(row.id)));
  }

  /** Where a category sits: its ancestors from the root, its children and all its descendants. */
  async hierarchy(id: string): Promise<CategoryHierarchyDto> {
    const categories = await this.list();
    const tree = new CategoryHierarchy(categories, (a, b) =>
      a.title.localeCompare(b.title),
    );
    const category = tree.get(id);
    if (!category) throw new NotFoundException(`Category ${id} not found`);
    return {
      category,
      ancestors: tree.ancestors(id),
      children: tree.children(id),
      descendants: tree.descendants(id),
    };
  }

  /**
   * Documents per category, computed in one query: those that have the
   * category itself, and those that have it or any descendant (each once).
   */
  private async counts(): Promise<Map<string, CategoryCounts>> {
    const { rows } = await this.svc.pool.query<{
      id: string;
      direct: number;
      total: number;
    }>(
      `with recursive tree (root, id) as (
         select id, id from ingestion.document_categories
         union
         select t.root, c.id
           from ingestion.document_categories c
           join tree t on c.parent_id = t.id
       )
       select c.id,
              (select count(*) from ingestion.uploads u
                where c.id = any(u.categories))::int as direct,
              (select count(*) from ingestion.uploads u
                where u.categories && array(select t.id from tree t where t.root = c.id))::int as total
         from ingestion.document_categories c`,
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { documentCount: row.direct, totalDocumentCount: row.total },
      ]),
    );
  }

  private async lockedHierarchy(
    client: pg.PoolClient,
  ): Promise<CategoryHierarchy<CategoryRow>> {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      HIERARCHY_LOCK,
    ]);
    const rows = await drizzle(client).select().from(documentCategories);
    return new CategoryHierarchy(rows);
  }

  /**
   * The dimension a new category under `parentId` gets: its parent's. A
   * dimension given explicitly must match it.
   */
  private placement(
    tree: CategoryHierarchy<CategoryRow>,
    id: string,
    parentId: string | null,
    dimension: CategoryDimension | null | undefined,
  ): CategoryDimension | null {
    if (parentId === null) return dimension ?? null;
    const parent = tree.get(parentId);
    if (!parent)
      throw new UnprocessableEntityException(
        `The parent category ${parentId} does not exist`,
      );
    if (dimension && dimension !== parent.dimension)
      throw new UnprocessableEntityException(
        `${parentId} is a ${dimensionName(parent.dimension)} category, so ${id} must be one too: subcategories share their parent's dimension`,
      );
    return parent.dimension;
  }

  /** Adds a category by hand; the worker matches it from the next document on. */
  async create(request: CreateCategory): Promise<CategoryDto> {
    try {
      return await withTransaction(this.svc.pool, async (client) => {
        await assertWritable(client);
        const tree = await this.lockedHierarchy(client);
        const dimension = this.placement(
          tree,
          request.id,
          request.parentId,
          request.dimension,
        );
        // A category added by hand is a confirmation of its own: one version,
        // so documents parsed before it get checked against it.
        const taxonomyVersion = await bumpTaxonomyVersion(client);
        const [row] = await drizzle(client)
          .insert(documentCategories)
          .values({
            id: request.id,
            title: request.title,
            description: request.description,
            templateJson: request.template,
            parentId: request.parentId,
            dimension,
            taxonomyVersion,
          })
          .onConflictDoNothing({ target: documentCategories.id })
          .returning();
        if (!row)
          throw new ConflictException(
            `A category with id ${request.id} already exists`,
          );
        await enqueueCategoriesChanged(client, this.svc.schema, [row.id]);
        return toCategoryDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Another category already has this title');
      throw error;
    }
  }

  /**
   * Deletes a category. Its documents are never deleted: the category is taken
   * off them (with the template fields only it asked for, unless they hold a
   * value), or replaced by its parent when `documents` is MOVE_TO_PARENT. A
   * category with subcategories needs an explicit `children` choice: they
   * move up to its parent, or become top-level. They keep their ids and
   * documents either way.
   */
  async remove(id: string, options: DeleteCategory): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      const tree = await this.lockedHierarchy(client);
      const category = tree.get(id);
      if (!category) throw new NotFoundException(`Category ${id} not found`);
      const children = tree.children(id).map((child) => child.id);
      if (children.length && !options.children)
        throw new ConflictException(
          `${id} has ${children.length} subcategor${children.length === 1 ? 'y' : 'ies'} (${children.join(', ')}): choose whether they move to its parent or become top-level categories`,
        );
      if (options.documents === 'MOVE_TO_PARENT' && !category.parentId)
        throw new UnprocessableEntityException(
          `${id} has no parent to move its documents to`,
        );
      const newParent =
        options.children === 'MOVE_TO_PARENT' ? category.parentId : null;
      if (children.length)
        await client.query(
          `update ingestion.document_categories
              set parent_id = $1, updated_at = now()
            where id = any($2::text[])`,
          [newParent, children],
        );
      const { rows } = await client.query<{ id: string }>(
        options.documents === 'MOVE_TO_PARENT'
          ? `update ingestion.uploads
                set categories = case when $2 = any(categories)
                                      then array_remove(categories, $1)
                                      else array_replace(categories, $1, $2) end,
                    updated_at = now()
              where $1 = any(categories)
              returning id`
          : `update ingestion.uploads
                set categories = array_remove(categories, $1), updated_at = now()
              where $1 = any(categories)
              returning id`,
        options.documents === 'MOVE_TO_PARENT' ? [id, category.parentId] : [id],
      );
      await drizzle(client)
        .delete(documentCategories)
        .where(eq(documentCategories.id, id));
      await this.resyncUploads(
        client,
        rows.map((row) => row.id),
      );
      await enqueueCategoriesChanged(client, this.svc.schema, children, [
        { id, title: category.title },
      ]);
    });
  }

  /**
   * Edits a category. A new `parentId` moves it with its whole subtree; its
   * id and document assignments never change, so documents follow it. Moving
   * under its own descendant (or itself) is refused. Subcategories share
   * their parent's dimension: a general tree moved under a typed parent takes
   * the parent's, a typed one must match it, and a root's dimension change
   * applies to its whole tree.
   */
  async update(id: string, request: UpdateCategory): Promise<CategoryDto> {
    const row = await this.saveUpdate(id, request);
    return toCategoryDto(row, (await this.counts()).get(id));
  }

  private async saveUpdate(
    id: string,
    request: UpdateCategory,
  ): Promise<CategoryRow> {
    try {
      return await withTransaction(this.svc.pool, async (client) => {
        await assertWritable(client);
        const tree = await this.lockedHierarchy(client);
        const current = tree.get(id);
        if (!current) throw new NotFoundException(`Category ${id} not found`);
        const parentId =
          request.parentId !== undefined ? request.parentId : current.parentId;
        const moved = parentId !== current.parentId;
        if (moved) {
          const problem = tree.moveProblem(id, parentId);
          if (problem) throw new UnprocessableEntityException(problem);
        }

        let dimension = current.dimension;
        if (parentId !== null) {
          const parent = tree.get(parentId)!;
          if (
            request.dimension !== undefined &&
            request.dimension !== parent.dimension
          )
            throw new UnprocessableEntityException(
              `${id} is under ${parentId}, so its dimension is ${dimensionName(parent.dimension)}: change it on the top-level category of its tree`,
            );
          if (
            moved &&
            current.dimension !== null &&
            current.dimension !== parent.dimension
          )
            throw new UnprocessableEntityException(
              `${id} is a ${dimensionName(current.dimension)} category and ${parentId} a ${dimensionName(parent.dimension)} one: subcategories share their parent's dimension`,
            );
          dimension = parent.dimension;
        } else if (request.dimension !== undefined) {
          dimension = request.dimension;
        }

        const db = drizzle(client);
        const [row] = await db
          .update(documentCategories)
          .set({
            ...(request.title ? { title: request.title } : {}),
            ...(request.description
              ? { description: request.description }
              : {}),
            ...(request.template ? { templateJson: request.template } : {}),
            parentId,
            dimension,
            updatedAt: new Date(),
          })
          .where(eq(documentCategories.id, id))
          .returning();
        const descendants = tree.descendants(id).map((child) => child.id);
        const dimensionChanged = dimension !== current.dimension;
        if (dimensionChanged && descendants.length)
          await db
            .update(documentCategories)
            .set({ dimension, updatedAt: new Date() })
            .where(inArray(documentCategories.id, descendants));
        await enqueueCategoriesChanged(client, this.svc.schema, [
          id,
          ...(dimensionChanged ? descendants : []),
        ]);
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Another category already has this title');
      if (isCycleViolation(error))
        throw new UnprocessableEntityException(
          'A category cannot move under its own descendant',
        );
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

  /** Confirms one suggestion: a batch of one (one taxonomy version). */
  async approve(
    suggestionId: string,
    request: ApproveSuggestion,
  ): Promise<CategorySuggestionDto> {
    const [approved] = await this.approveMany({
      items: [{ id: suggestionId, overrides: request }],
    });
    return approved;
  }

  /**
   * Confirms several suggestions at once, as the Categories page does with
   * its checkboxes: each becomes a category (with your edits, if any) and is
   * added to the documents that suggested it. All or nothing, in one
   * transaction, and **one** taxonomy version for the whole batch, however
   * many it confirms. From the next document on, the worker matches them like
   * any other category.
   */
  async approveMany(
    request: ApproveSuggestions,
  ): Promise<CategorySuggestionDto[]> {
    try {
      return await withTransaction(this.svc.pool, async (client) => {
        await assertWritable(client);
        const result = await this.approveInTransaction(client, request.items);
        await this.resyncUploads(client, result.uploadIds);
        return result.approved;
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'A category with this title already exists',
        );
      throw error;
    }
  }

  /**
   * Turns suggestions into categories inside the caller's transaction (which
   * has passed `assertWritable`), with one taxonomy version for all of them,
   * and adds each to the documents that suggested it. The caller resyncs the
   * returned documents' fields.
   */
  async approveInTransaction(
    client: pg.PoolClient,
    items: { id: string; overrides?: ApproveSuggestion }[],
  ): Promise<{
    approved: CategorySuggestionDto[];
    uploadIds: string[];
    categoryIds: string[];
  }> {
    const ids = [...new Set(items.map((item) => item.id))];
    if (ids.length !== items.length)
      throw new UnprocessableEntityException(
        'The same suggestion is listed twice',
      );
    const db = drizzle(client);
    let tree = await this.lockedHierarchy(client);
    const rows = await db
      .select()
      .from(categorySuggestions)
      .where(inArray(categorySuggestions.id, ids))
      .orderBy(asc(categorySuggestions.createdAt))
      .for('update');
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new NotFoundException(`Suggestion ${id} not found`);
      if (row.status !== 'PENDING')
        throw new ConflictException(
          `${row.title} was already ${row.status.toLowerCase()}`,
        );
    }
    const taxonomyVersion = await bumpTaxonomyVersion(client);
    const approved: CategorySuggestionDto[] = [];
    const uploadIds = new Set<string>();
    const categoryIds: string[] = [];
    for (const item of items) {
      const suggestion = rows.find((row) => row.id === item.id)!;
      const request = item.overrides ?? {};
      const id = request.id ?? suggestion.categoryId;
      // Your choice of parent is checked strictly; the AI's is a proposal,
      // dropped (keeping its dimension) if that parent is gone since.
      const proposedParent =
        suggestion.parentId && tree.get(suggestion.parentId)
          ? suggestion.parentId
          : null;
      const parentId =
        request.parentId !== undefined ? request.parentId : proposedParent;
      const dimension = this.placement(
        tree,
        id,
        parentId,
        request.dimension !== undefined
          ? request.dimension
          : parentId
            ? undefined
            : suggestion.dimension,
      );
      const inserted = await db
        .insert(documentCategories)
        .values({
          id,
          title: request.title ?? suggestion.title,
          description: request.description ?? suggestion.description,
          templateJson: request.template ?? suggestion.templateJson,
          parentId,
          dimension,
          taxonomyVersion,
        })
        .onConflictDoNothing({ target: documentCategories.id })
        .returning();
      if (!inserted.length)
        throw new ConflictException(
          `A category with id ${id} already exists; approve it under another id or reject it`,
        );
      // A later item may go under the category just created.
      tree = new CategoryHierarchy([...tree.categories, inserted[0]]);
      const [row] = await db
        .update(categorySuggestions)
        .set({
          status: 'APPROVED',
          approvedCategoryId: id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(categorySuggestions.id, suggestion.id))
        .returning();
      approved.push(toSuggestionDto(row));
      categoryIds.push(id);
      if (suggestion.uploadIds.length) {
        await client.query(
          `update ingestion.uploads
              set categories = case when $1 = any(categories) then categories
                                    else array_append(categories, $1) end,
                  rejected_categories = array_remove(rejected_categories, $1),
                  updated_at = now()
            where id = any($2::uuid[])`,
          [id, suggestion.uploadIds],
        );
        for (const uploadId of suggestion.uploadIds) uploadIds.add(uploadId);
      }
    }
    await enqueueCategoriesChanged(client, this.svc.schema, categoryIds);
    return { approved, uploadIds: [...uploadIds], categoryIds };
  }

  /**
   * Rejects a suggestion: it leaves the documents' suggested categories, and
   * the AI does not propose the same id again.
   */
  async reject(suggestionId: string): Promise<CategorySuggestionDto> {
    return withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      const [row] = await drizzle(client)
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
      if (!row) throw await this.notPending(suggestionId);
      await enqueueUploadUpdated(client, this.svc.schema, row.uploadIds);
      return toSuggestionDto(row);
    });
  }

  /**
   * Declines a suggestion for one document only: it leaves that document's
   * suggested categories and stays pending for the others. Declined by every
   * document, it is rejected.
   */
  async dismiss(
    suggestionId: string,
    uploadId: string,
  ): Promise<CategorySuggestionDto> {
    return withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      const row = await this.dismissInTransaction(client, suggestionId, uploadId);
      await enqueueUploadUpdated(client, this.svc.schema, [uploadId]);
      return row;
    });
  }

  /**
   * Declines a suggestion for one document inside the caller's transaction,
   * and remembers the category on the document so no later check proposes it
   * for it again.
   */
  async dismissInTransaction(
    client: pg.PoolClient,
    suggestionId: string,
    uploadId: string,
  ): Promise<CategorySuggestionDto> {
    const remaining = sql`array_remove(${categorySuggestions.uploadIds}, ${uploadId}::uuid)`;
    const [row] = await drizzle(client)
      .update(categorySuggestions)
      .set({
        uploadIds: remaining,
        status: sql`case when cardinality(${remaining}) = 0 then 'REJECTED'::ingestion.suggestion_status else ${categorySuggestions.status} end`,
        reviewedAt: sql`case when cardinality(${remaining}) = 0 then now() else ${categorySuggestions.reviewedAt} end`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(categorySuggestions.id, suggestionId),
          eq(categorySuggestions.status, 'PENDING'),
          sql`${uploadId}::uuid = any(${categorySuggestions.uploadIds})`,
        ),
      )
      .returning();
    if (!row) {
      const error = await this.notPending(suggestionId);
      if (!(error instanceof ConflictException)) throw error;
      const [existing] = await drizzle(client)
        .select()
        .from(categorySuggestions)
        .where(eq(categorySuggestions.id, suggestionId));
      throw existing.status === 'PENDING'
        ? new NotFoundException(
            `This suggestion was not made for document ${uploadId}`,
          )
        : error;
    }
    await this.rememberDeclined(client, uploadId, [row.categoryId]);
    return toSuggestionDto(row);
  }

  /** Category ids declined for a document: never proposed for it again. */
  async rememberDeclined(
    client: pg.PoolClient,
    uploadId: string,
    categoryIds: string[],
  ): Promise<void> {
    if (!categoryIds.length) return;
    await client.query(
      `update ingestion.uploads
          set rejected_categories = array(
                select distinct unnest(rejected_categories || $2::text[])),
              updated_at = now()
        where id = $1`,
      [uploadId, categoryIds],
    );
  }

  /**
   * Parse now: asks the parse worker to start a run outside its schedule. The
   * worker listens on `parse_requested`; the timestamp lets one that was
   * offline see the request when it starts.
   */
  async requestRun(): Promise<ParseQueueDto> {
    await withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      await client.query(
        `insert into ingestion.parse_queue (id, run_requested_at) values ($1, now())
         on conflict (id) do update set run_requested_at = now(), updated_at = now()`,
        [PARSE_QUEUE_ID],
      );
      await client.query(`select pg_notify('parse_requested', '')`);
    });
    return this.queue();
  }

  /** Edits a pending suggestion before you decide on it. */
  async updateSuggestion(
    suggestionId: string,
    request: UpdateSuggestion,
  ): Promise<CategorySuggestionDto> {
    try {
      return await withTransaction(this.svc.pool, async (client) => {
        await assertWritable(client);
        const db = drizzle(client);
        if (request.id) {
          const [taken] = await db
            .select({ id: documentCategories.id })
            .from(documentCategories)
            .where(eq(documentCategories.id, request.id));
          if (taken)
            throw new ConflictException(
              `A category with id ${request.id} already exists`,
            );
        }
        const placement: {
          parentId?: string | null;
          dimension?: CategoryDimension | null;
        } = {};
        if (request.parentId !== undefined || request.dimension !== undefined) {
          const [current] = await db
            .select()
            .from(categorySuggestions)
            .where(eq(categorySuggestions.id, suggestionId));
          if (!current) throw await this.notPending(suggestionId);
          const parentId =
            request.parentId !== undefined
              ? request.parentId
              : current.parentId;
          placement.parentId = parentId;
          placement.dimension = this.placement(
            await this.lockedHierarchy(client),
            request.id ?? current.categoryId,
            parentId,
            request.dimension !== undefined
              ? request.dimension
              : parentId
                ? undefined
                : current.dimension,
          );
        }
        const [row] = await db
          .update(categorySuggestions)
          .set({
            ...placement,
            ...(request.id ? { categoryId: request.id } : {}),
            ...(request.title ? { title: request.title } : {}),
            ...(request.description
              ? { description: request.description }
              : {}),
            ...(request.template ? { templateJson: request.template } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(categorySuggestions.id, suggestionId),
              eq(categorySuggestions.status, 'PENDING'),
            ),
          )
          .returning();
        if (!row) throw await this.notPending(suggestionId);
        if (request.id)
          await enqueueUploadUpdated(client, this.svc.schema, row.uploadIds);
        return toSuggestionDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'Another pending suggestion already uses this id',
        );
      throw error;
    }
  }

  private async notPending(suggestionId: string): Promise<Error> {
    const [existing] = await this.svc.db
      .select()
      .from(categorySuggestions)
      .where(eq(categorySuggestions.id, suggestionId));
    if (!existing)
      return new NotFoundException(`Suggestion ${suggestionId} not found`);
    return new ConflictException(
      `This suggestion was already ${existing.status.toLowerCase()}`,
    );
  }

  /**
   * After documents' categories changed: align their extracted fields with
   * the categories' templates, and tell the review inbox.
   */
  async resyncUploads(
    client: pg.PoolClient,
    uploadIds: string[],
  ): Promise<void> {
    if (!uploadIds.length) return;
    const db = drizzle(client);
    const rows = await db
      .select()
      .from(uploads)
      .where(inArray(uploads.id, uploadIds));
    const ids = [...new Set(rows.flatMap((row) => row.categories))];
    const categories = ids.length
      ? await db
          .select()
          .from(documentCategories)
          .where(inArray(documentCategories.id, ids))
      : [];
    for (const row of rows) {
      if (!row.extractedFields) continue;
      const assigned = row.categories.flatMap((categoryId) =>
        categories
          .filter((category) => category.id === categoryId)
          .map((category) => ({
            id: category.id,
            template: category.templateJson,
          })),
      );
      await db
        .update(uploads)
        .set({
          extractedFields: syncTemplateFields(row.extractedFields, assigned),
        })
        .where(eq(uploads.id, row.id));
    }
    await enqueueUploadUpdated(client, this.svc.schema, uploadIds);
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
