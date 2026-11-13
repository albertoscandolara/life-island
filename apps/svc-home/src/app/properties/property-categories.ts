import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  addressMatch,
  CATEGORY_ID_PATTERN,
  hasStreetNumber,
  namesVehicle,
  type CategoryDto,
  type CreateCategoryRequest,
  type UpdateCategoryRequest,
} from '@life-island/contracts';
import { eq } from 'drizzle-orm';
import { normalizeText } from '../bills/bill-reader.js';
import { CONFIG, SERVICE_DB, type HomeConfig } from '../config.js';
import { properties, type PropertyRow } from '../db/schema.js';

/** The category fields this module reads; ingestion serves more. */
export type CategoryLike = Pick<CategoryDto, 'id' | 'title' | 'dimension'> &
  Partial<Pick<CategoryDto, 'parentId'>>;

type HomeLike = Pick<PropertyRow, 'name' | 'address' | 'matchTerms'>;

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

/** What tidying the PROPERTY categories does, so each home has exactly one. */
export interface PropertyTidyPlan {
  /** Duplicates of a home's category: their documents move to `into`. */
  merges: { from: CategoryLike; into: CategoryLike }[];
  /** A home's category named by its street only, renamed to the full address. */
  renames: { id: string; title: string }[];
  /** The one category of each home that has one, by the home's index. */
  links: Map<number, CategoryLike>;
  /** Cars filed as places ("Fiat Punto EJ560PZ"): moved to the SUBJECT dimension. */
  vehicles: CategoryLike[];
}

/**
 * Plans the clean-up of the "Property / location" values: every PROPERTY
 * category that names a home (by its name, match terms or address) becomes
 * one, the one with the full address when there is one, so "Via Ponzilovo"
 * merges into "Via Ponzilovo 9". A category that names two homes is left as
 * it is. Categories that are cars leave the dimension.
 */
export function planPropertyTidy(
  homes: readonly (HomeLike & Pick<PropertyRow, 'categoryIds'>)[],
  categories: readonly CategoryLike[],
): PropertyTidyPlan {
  const property = categories.filter((c) => c.dimension === 'PROPERTY');
  const termsOf = (home: HomeLike) =>
    [home.name, ...home.matchTerms]
      .map(normalizeText)
      .filter((term) => term.length > 1);
  const hitsOf = (home: HomeLike) =>
    property.filter((category) => {
      const text = ` ${normalizeText(category.title)} ${normalizeText(category.id)} `;
      return (
        termsOf(home).some((term) => text.includes(` ${term} `)) ||
        addressMatch(category.title, home.address) !== null
      );
    });
  const hits = homes.map(hitsOf);
  const homesOf = new Map<string, number>();
  for (const list of hits)
    for (const category of list)
      homesOf.set(category.id, (homesOf.get(category.id) ?? 0) + 1);

  const plan: PropertyTidyPlan = {
    merges: [],
    renames: [],
    links: new Map(),
    vehicles: property.filter(
      (c) =>
        !c.parentId &&
        namesVehicle(c) &&
        !homes.some((home) => home.categoryIds.includes(c.id)),
    ),
  };
  homes.forEach((home, index) => {
    // Its full address is always its own; anything else only when no other home's.
    const own = hits[index].filter(
      (c) =>
        !plan.vehicles.includes(c) &&
        (homesOf.get(c.id) === 1 ||
          addressMatch(c.title, home.address) === 'full'),
    );
    if (!own.length) return;
    const keep =
      own.find((c) => addressMatch(c.title, home.address) === 'full') ??
      own.find((c) => home.categoryIds.includes(c.id)) ??
      own[0];
    plan.links.set(index, keep);
    for (const other of own)
      if (other !== keep) plan.merges.push({ from: other, into: keep });
    if (
      home.address &&
      hasStreetNumber(home.address) &&
      addressMatch(keep.title, home.address) === 'street'
    )
      plan.renames.push({ id: keep.id, title: home.address.trim() });
  });
  return plan;
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
    // Named by its address, as the review inbox shows it: "Via dei Bandi, 10".
    title: (home.address ?? home.name).trim().slice(0, 100),
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

  /**
   * Tidies the PROPERTY categories (one per home, cars out) and links every
   * home to its category, creating the missing ones; true when all are linked.
   */
  async syncAll(): Promise<boolean> {
    const rows = await this.svc.db.select().from(properties);
    if (!rows.length) return true;
    let categories = await this.listCategories();
    if (await this.tidy(rows, categories))
      categories = await this.listCategories();
    const plan = planPropertyTidy(rows, categories);
    let ok = true;
    for (const [index, row] of rows.entries()) {
      const category = plan.links.get(index);
      if (category) {
        // Its category first; other categories you linked stay while they exist.
        const ids = [
          category.id,
          ...row.categoryIds.filter(
            (id) => id !== category.id && categories.some((c) => c.id === id),
          ),
        ];
        if (ids.join() !== row.categoryIds.join())
          await this.setCategory(row, category, ids);
      } else if (
        !row.categoryIds.some((id) => categories.some((c) => c.id === id))
      ) {
        // Not linked, or linked to a category that is gone.
        ok =
          (await this.link({ ...row, categoryIds: [] }, categories)) !== null &&
          ok;
      }
    }
    return ok;
  }

  /** Applies the clean-up plan; true when it changed any category. */
  private async tidy(
    rows: PropertyRow[],
    categories: CategoryLike[],
  ): Promise<boolean> {
    const plan = planPropertyTidy(rows, categories);
    let changed = false;
    for (const vehicle of plan.vehicles) {
      // Its documents keep it; it just stops being offered as a place.
      if (!(await this.patchCategory(vehicle.id, { dimension: 'SUBJECT' })))
        continue;
      changed = true;
      this.logger.log(
        `"${vehicle.title}" is a car, not a property: moved to Subject`,
      );
    }
    for (const { from, into } of plan.merges) {
      // Under the one that stays, then deleted: its documents move up to it.
      if (into.parentId === from.id)
        await this.patchCategory(into.id, { parentId: from.parentId ?? null });
      if (!(await this.patchCategory(from.id, { parentId: into.id }))) continue;
      const response = await fetch(
        `${this.config.ingestionUrl}/categories/${encodeURIComponent(from.id)}?documents=MOVE_TO_PARENT&children=MOVE_TO_PARENT`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        this.logger.warn(
          `svc-ingestion refused to merge ${from.id} into ${into.id} (${response.status}): ${await response.text()}`,
        );
        continue;
      }
      changed = true;
      this.logger.log(`"${from.title}" merged into "${into.title}"`);
    }
    for (const rename of plan.renames)
      changed =
        (await this.patchCategory(rename.id, { title: rename.title })) ||
        changed;
    return changed;
  }

  private async patchCategory(
    id: string,
    request: UpdateCategoryRequest,
  ): Promise<boolean> {
    const response = await fetch(
      `${this.config.ingestionUrl}/categories/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
    if (response.ok) return true;
    this.logger.warn(
      `svc-ingestion refused to change ${id} (${response.status}): ${await response.text()}`,
    );
    return false;
  }

  private async setCategory(
    row: PropertyRow,
    category: CategoryLike,
    categoryIds = [category.id],
  ): Promise<PropertyRow | null> {
    const [updated] = await this.svc.db
      .update(properties)
      .set({ categoryIds })
      .where(eq(properties.id, row.id))
      .returning();
    this.logger.log(`Home "${row.name}" linked to category ${category.id}`);
    return updated ?? null;
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
      const id = categoryIdFor(row.address ?? row.name);
      const taken = categories.find((c) => c.id === id);
      category =
        taken?.dimension === 'PROPERTY'
          ? taken
          : await this.createCategory(
              propertyCategoryRequest(row, taken ? `${id}_HOME` : id),
            );
    }
    if (!category) return null;
    return this.setCategory(row, category);
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
