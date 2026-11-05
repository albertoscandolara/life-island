import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  CATEGORY_ID_PATTERN,
  type CategoryDto,
  type CreateCategoryRequest,
} from '@life-island/contracts';
import { eq } from 'drizzle-orm';
import { normalizeText } from '../bills/bill-reader.js';
import { CONFIG, SERVICE_DB, type HomeConfig } from '../config.js';
import { properties, type PropertyRow } from '../db/schema.js';

/** The category fields this module reads; ingestion serves more. */
export type CategoryLike = Pick<CategoryDto, 'id' | 'title' | 'dimension'>;

/** "Via dei Bandi" → "VIA_DEI_BANDI"; a name with no letters gets a fallback. */
export function categoryIdFor(name: string): string {
  const id = normalizeText(name).toUpperCase().replace(/ /g, '_').slice(0, 64);
  return CATEGORY_ID_PATTERN.test(id) ? id : `HOME_${id}`.slice(0, 64);
}

/**
 * The PROPERTY category that already stands for this home: one whose title
 * or id names it ("Via Ponzilovo", VIA_PONZILOVO, PONZILOVO_HOUSE). Null when
 * none does, or when several do and picking one would be a guess.
 */
export function findPropertyCategory(
  home: Pick<PropertyRow, 'name' | 'matchTerms'>,
  categories: readonly CategoryLike[],
): CategoryLike | null {
  const terms = [home.name, ...home.matchTerms]
    .map(normalizeText)
    .filter((term) => term.length > 1);
  const hits = categories.filter((category) => {
    if (category.dimension !== 'PROPERTY') return false;
    const text = ` ${normalizeText(category.title)} ${normalizeText(category.id)} `;
    return terms.some((term) => text.includes(` ${term} `));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** What the AI reads to decide whether a document is about this home. */
export function propertyCategoryRequest(
  home: Pick<PropertyRow, 'name' | 'address' | 'city' | 'matchTerms'>,
  id: string,
): CreateCategoryRequest {
  const where = [home.address ?? home.name, home.city]
    .filter(Boolean)
    .join(', ');
  const terms = home.matchTerms.length
    ? ` Its address contains "${home.matchTerms.join('" or "')}".`
    : '';
  return {
    id,
    title: home.name,
    description:
      `Documents about the home at ${where}: utility bills supplied there, works, contracts and taxes of that property.${terms} ` +
      'Assign it by the supply or property address (indirizzo di fornitura), never by the address a bill is mailed to.',
    dimension: 'PROPERTY',
  };
}

const RETRY_MS = 30_000;
const MAX_RETRIES = 20;

/**
 * Keeps every home linked to a PROPERTY category of the documents app, so the
 * review inbox offers your homes as "Property / location", the AI can assign
 * them while it reads a document, and Bills matches bills by them. An existing
 * category that names the home is reused; otherwise one is created through
 * svc-ingestion's API (this service never touches its tables). A home you
 * already linked to categories is left as it is.
 */
@Injectable()
export class PropertyCategories
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PropertyCategories.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: HomeConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.linkPropertyCategories) void this.syncWithRetries(0);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Links every home without categories; true when all are linked. */
  async syncAll(): Promise<boolean> {
    const rows = await this.svc.db.select().from(properties);
    const unlinked = rows.filter((row) => !row.categoryIds.length);
    if (!unlinked.length) return true;
    const categories = await this.listCategories();
    let ok = true;
    for (const row of unlinked)
      ok = (await this.link(row, categories)) !== null && ok;
    return ok;
  }

  /** Links one home, best effort: a failure is logged and retried at the next start. */
  async ensure(row: PropertyRow): Promise<PropertyRow> {
    if (!this.config.linkPropertyCategories || row.categoryIds.length)
      return row;
    try {
      return (await this.link(row, await this.listCategories())) ?? row;
    } catch (error) {
      this.logger.warn(
        `Could not link "${row.name}" to a category: ${String(error)}`,
      );
      return row;
    }
  }

  private async syncWithRetries(attempt: number): Promise<void> {
    try {
      if (await this.syncAll()) return;
    } catch (error) {
      this.logger.warn(
        `Linking homes to categories failed (attempt ${attempt + 1}): ${String(error)}`,
      );
    }
    if (attempt + 1 >= MAX_RETRIES) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncWithRetries(attempt + 1);
    }, RETRY_MS);
    this.timer.unref?.();
  }

  private async link(
    row: PropertyRow,
    categories: CategoryLike[],
  ): Promise<PropertyRow | null> {
    let category = findPropertyCategory(row, categories);
    if (!category) {
      const id = categoryIdFor(row.name);
      const taken = categories.find((c) => c.id === id);
      category =
        taken?.dimension === 'PROPERTY'
          ? taken
          : await this.createCategory(
              propertyCategoryRequest(row, taken ? `${id}_HOME` : id),
            );
    }
    if (!category) return null;
    const [updated] = await this.svc.db
      .update(properties)
      .set({ categoryIds: [category.id] })
      .where(eq(properties.id, row.id))
      .returning();
    this.logger.log(`Home "${row.name}" linked to category ${category.id}`);
    return updated ?? null;
  }

  private async listCategories(): Promise<CategoryLike[]> {
    const response = await fetch(`${this.config.ingestionUrl}/categories`);
    if (!response.ok)
      throw new Error(`svc-ingestion answered ${response.status}`);
    return (await response.json()) as CategoryLike[];
  }

  private async createCategory(
    request: CreateCategoryRequest,
  ): Promise<CategoryLike | null> {
    const response = await fetch(`${this.config.ingestionUrl}/categories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (response.ok) return (await response.json()) as CategoryLike;
    // 423 while a reclassification runs, 409 on a title clash: try again later.
    this.logger.warn(
      `svc-ingestion refused category ${request.id} (${response.status}): ${await response.text()}`,
    );
    return null;
  }
}
