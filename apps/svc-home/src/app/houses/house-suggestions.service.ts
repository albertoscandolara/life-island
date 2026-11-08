import {
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  type ApproveHouseSuggestionRequest,
  type HouseField,
  type HouseSuggestionDto,
  type PropertyDto,
  type UpdatePropertyRequest,
} from '@life-island/contracts';
import { eq, inArray, isNull } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  billOverrides,
  categoryTree,
  documents,
  houseReviews,
  type DecidedHouseChange,
} from '../db/schema.js';
import { normalizeCode, normalizeText } from '../bills/bill-reader.js';
import {
  defaultMatchTerms,
  PropertiesService,
  toPropertyDto,
} from '../properties/properties.service.js';
import {
  mergeReadings,
  proposeHouseChanges,
  readHouse,
  supplierField,
  type HouseFacts,
  type HouseReading,
} from './house-reader.js';

interface Group {
  suggestion: HouseSuggestionDto;
  facts: HouseFacts;
  /** For a new house, the address words its documents share. */
  street: string | null;
}

/** "Via Roma 5" when a new house is suggested, else its town. */
function suggestedName(facts: HouseFacts): string {
  return facts.values.address ?? facts.values.city ?? 'New house';
}

/**
 * Turns what your documents say about houses into suggestions: a house you
 * do not have yet, or new or different data of one you have. Like People's
 * reviews, nothing reaches a house until you approve it; your decision is
 * kept per document, so a decided document is never suggested again.
 */
@Injectable()
export class HouseSuggestionsService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(PropertiesService) private readonly properties: PropertiesService,
  ) {}

  async list(): Promise<HouseSuggestionDto[]> {
    return (await this.groups()).map((g) => g.suggestion);
  }

  /**
   * Takes what the documents say into a house: the one you pick (taking the
   * values you accept), or a new one made from them. A house picked for a new
   * address learns its words, so its next documents go there on their own.
   */
  async approve(request: ApproveHouseSuggestionRequest): Promise<PropertyDto> {
    const group = await this.groupOf(request.uploadIds);
    const accept = new Set<HouseField>(request.accept ?? []);
    const propertyId = request.propertyId;

    let house: PropertyDto;
    let created = false;
    if (propertyId === null) {
      const changes = proposeHouseChanges(group.facts, null).filter((c) =>
        accept.has(c.field),
      );
      house = await this.properties.create({
        name:
          request.name ?? group.suggestion.name ?? suggestedName(group.facts),
        ...this.valuesOf(changes, null),
        matchTerms: group.street ? defaultMatchTerms(group.street) : undefined,
      });
      created = true;
    } else {
      house = toPropertyDto(await this.properties.get(propertyId));
    }

    const proposed = proposeHouseChanges(group.facts, created ? null : house);
    const decided: DecidedHouseChange[] = proposed.map((c) => ({
      field: c.field,
      previous: created ? null : c.current,
      proposed: c.proposed,
      decision: accept.has(c.field) ? 'accepted' : 'kept_current',
    }));

    if (!created) {
      const update: UpdatePropertyRequest = this.valuesOf(
        proposed.filter((c) => accept.has(c.field)),
        house,
      );
      // A new address filed under this house: its documents follow it from now on.
      if (group.suggestion.kind === 'new_house' && group.street) {
        const terms = new Set(house.matchTerms);
        for (const term of defaultMatchTerms(group.street)) terms.add(term);
        if (terms.size !== house.matchTerms.length)
          update.matchTerms = [...terms];
      }
      if (Object.keys(update).length)
        house = await this.properties.update(house.id, update);
    }

    await this.svc.db.transaction(async (tx) => {
      const already = await tx
        .select({ id: houseReviews.uploadId })
        .from(houseReviews)
        .where(inArray(houseReviews.uploadId, request.uploadIds));
      if (already.length)
        throw new ConflictException('These documents were already reviewed');
      await tx.insert(houseReviews).values(
        request.uploadIds.map((uploadId) => ({
          uploadId,
          status: 'approved' as const,
          propertyId: house.id,
          createdProperty: created,
          changes: decided,
        })),
      );
    });
    return house;
  }

  /** Not about any house of yours: the documents are not suggested again. */
  async dismiss(uploadIds: string[]): Promise<void> {
    await this.groupOf(uploadIds);
    const inserted = await this.svc.db
      .insert(houseReviews)
      .values(
        uploadIds.map((uploadId) => ({
          uploadId,
          status: 'dismissed' as const,
        })),
      )
      .onConflictDoNothing()
      .returning();
    if (!inserted.length)
      throw new ConflictException('These documents were already reviewed');
  }

  /** Brings back every dismissed document as a suggestion. */
  async reopenDismissed(): Promise<number> {
    const deleted = await this.svc.db
      .delete(houseReviews)
      .where(eq(houseReviews.status, 'dismissed'))
      .returning();
    return deleted.length;
  }

  /** The values to write on a house for the accepted changes. */
  private valuesOf(
    changes: ReturnType<typeof proposeHouseChanges>,
    house: PropertyDto | null,
  ): UpdatePropertyRequest {
    const update: UpdatePropertyRequest = {};
    for (const change of changes) {
      const field = change.field;
      if (field === 'supplyCodes') {
        update.supplyCodes = [
          ...(house?.supplyCodes ?? []),
          ...change.proposed.split(', '),
        ];
      } else if (field === 'owners') {
        update.owners = [
          ...(house?.owners ?? []),
          ...change.proposed
            .split(', ')
            .map((name) => ({ personId: null, name, share: null })),
        ];
      } else if (
        field === 'areaSqm' ||
        field === 'rooms' ||
        field === 'cadastralIncome'
      ) {
        update[field] = Number(change.proposed);
      } else {
        update[field] = change.proposed;
      }
    }
    return update;
  }

  /** The suggestion holding exactly these documents; a stale list gets a conflict. */
  private async groupOf(uploadIds: string[]): Promise<Group> {
    const wanted = new Set(uploadIds);
    const group = (await this.groups()).find(
      (g) =>
        g.suggestion.documents.length === wanted.size &&
        g.suggestion.documents.every((d) => wanted.has(d.uploadId)),
    );
    if (!group)
      throw new UnprocessableEntityException(
        'This suggestion changed in the meantime: reload and look at it again',
      );
    return group;
  }

  private async groups(): Promise<Group[]> {
    const [rows, props, overrides, tree, decided] = await Promise.all([
      this.svc.db.select().from(documents).where(isNull(documents.deletedAt)),
      this.properties.list(),
      this.svc.db.select().from(billOverrides),
      this.svc.db.select().from(categoryTree),
      this.svc.db.select({ id: houseReviews.uploadId }).from(houseReviews),
    ]);
    const parentOf = new Map(
      tree.filter((c) => !c.deleted).map((c) => [c.id, c.parentId]),
    );
    const overrideOf = new Map(overrides.map((o) => [o.uploadId, o]));
    const readings = rows
      .map((row) =>
        readHouse(row, props, parentOf, overrideOf.get(row.uploadId) ?? null),
      )
      .filter((r): r is HouseReading => r !== null);

    // A supplier comes only from the newest bill of each utility of a house,
    // so an old bill never brings back the supplier you left.
    const newest = new Map<string, HouseReading>();
    for (const r of readings) {
      if (!r.propertyId || !r.utility) continue;
      const key = `${r.propertyId}:${r.utility}`;
      const current = newest.get(key);
      if (!current || r.day + r.uploadedAt > current.day + current.uploadedAt)
        newest.set(key, r);
    }

    const done = new Set(decided.map((d) => d.id));
    const houseOf = new Map(props.map((p) => [p.id, p]));
    const byKey = new Map<
      string,
      {
        readings: HouseReading[];
        propertyId: string | null;
        street: string | null;
      }
    >();
    for (const reading of readings) {
      if (done.has(reading.uploadId)) continue;
      const house = reading.propertyId ? houseOf.get(reading.propertyId) : null;
      let key: string;
      if (house) {
        const own = this.withoutOldSupplier(reading, newest);
        const changes = proposeHouseChanges(mergeReadings([own]), house);
        if (!changes.length) continue;
        const signature = changes
          .map((c) => `${c.field}=${normalizeValue(c.field, c.proposed)}`)
          .join('|');
        key = `info:${house.id}:${signature}`;
        reading.values = own.values;
      } else if (reading.address) {
        key = `new:${normalizeText(reading.address.street)}`;
      } else continue;
      const entry = byKey.get(key) ?? {
        readings: [],
        propertyId: house?.id ?? null,
        street: house ? null : (reading.address?.street ?? null),
      };
      entry.readings.push(reading);
      byKey.set(key, entry);
    }

    return [...byKey.entries()]
      .map(([key, entry]) => {
        const facts = mergeReadings(entry.readings);
        const house = entry.propertyId ? houseOf.get(entry.propertyId)! : null;
        return {
          facts,
          street: entry.street,
          suggestion: {
            key,
            kind: house ? ('new_info' as const) : ('new_house' as const),
            propertyId: house?.id ?? null,
            name: house ? null : suggestedName(facts),
            documents: entry.readings
              .map((r) => ({
                uploadId: r.uploadId,
                title: r.title,
                uploadedAt: r.uploadedAt,
              }))
              .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
            changes: proposeHouseChanges(facts, house),
          },
        };
      })
      .sort((a, b) =>
        a.suggestion.kind === b.suggestion.kind
          ? b.suggestion.documents[0].uploadedAt.localeCompare(
              a.suggestion.documents[0].uploadedAt,
            )
          : a.suggestion.kind === 'new_house'
            ? -1
            : 1,
      );
  }

  /** The reading without its supplier, unless it is the newest bill of its utility. */
  private withoutOldSupplier(
    reading: HouseReading,
    newest: Map<string, HouseReading>,
  ): HouseReading {
    if (!reading.utility || !reading.propertyId) return reading;
    if (newest.get(`${reading.propertyId}:${reading.utility}`) === reading)
      return reading;
    const values = { ...reading.values };
    delete values[supplierField(reading.utility)];
    return { ...reading, values };
  }
}

function normalizeValue(field: HouseField, value: string): string {
  return field === 'supplyCodes' ? normalizeCode(value) : normalizeText(value);
}
