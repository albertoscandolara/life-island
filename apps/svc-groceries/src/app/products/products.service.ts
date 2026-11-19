import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectStorage, type ServiceDb } from '@life-island/be-common';
import { readUploadedImage } from '@life-island/be-nest';
import {
  productKey,
  type GroceryItemRequest,
  groceryItemRequestSchema,
} from '@life-island/contracts';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import { CONFIG, SERVICE_DB, type GroceriesConfig } from '../config.js';
import { products, receiptItems, type ProductRow } from '../db/schema.js';

type ItemChange = z.output<typeof groceryItemRequestSchema>;

/**
 * The items of "What you buy" as things you can keep: rename one (on every
 * receipt line, merging it into an item of that name), move it to another
 * aisle, add its link and photo, or remove it from the list.
 */
@Injectable()
export class ProductsService {
  private readonly log = new Logger(ProductsService.name);
  private readonly storage: ObjectStorage | null;
  private ready: Promise<void> | null = null;

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CONFIG) config: GroceriesConfig,
  ) {
    this.storage = config.storage ? new ObjectStorage(config.storage) : null;
  }

  /** Every product, by its name key. */
  async byKey(): Promise<Map<string, ProductRow>> {
    const rows = await this.svc.db.select().from(products);
    return new Map(rows.map((row) => [row.nameKey, row]));
  }

  /**
   * Changes an item. A new name renames its receipt lines too; when another
   * item already has that name, the two become one, keeping that item's
   * link and photo when it has them. A new aisle moves every line.
   */
  async update(
    id: string,
    change: ItemChange | GroceryItemRequest,
  ): Promise<{ id: string }> {
    const product = await this.find(id);
    const name = change.name.trim();
    const key = productKey(name);
    const link = change.link === undefined ? product.link : change.link;
    const lines = sql`lower(btrim(${receiptItems.normalizedName})) = ${product.nameKey}`;
    return this.svc.db.transaction(async (tx) => {
      if (change.category)
        await tx
          .update(receiptItems)
          .set({ category: change.category })
          .where(lines);
      if (name !== product.name)
        await tx
          .update(receiptItems)
          .set({ normalizedName: name })
          .where(lines);
      if (key === product.nameKey) {
        await tx
          .update(products)
          .set({ name, link: link ?? null, updatedAt: new Date() })
          .where(eq(products.id, id));
        return { id };
      }
      const [other] = await tx
        .select()
        .from(products)
        .where(eq(products.nameKey, key));
      if (!other) {
        await tx
          .update(products)
          .set({
            nameKey: key,
            name,
            link: link ?? null,
            updatedAt: new Date(),
          })
          .where(eq(products.id, id));
        return { id };
      }
      if (other.hidden && !product.hidden)
        throw new ConflictException(
          `"${other.name}" was removed from What you buy: pick another name`,
        );
      // Merged: the item of that name stays, with what this one adds.
      await tx
        .update(products)
        .set({
          name,
          link: other.link ?? link ?? null,
          imageKey: other.imageKey ?? product.imageKey,
          imageType: other.imageKey ? other.imageType : product.imageType,
          imageUpdatedAt: other.imageKey
            ? other.imageUpdatedAt
            : product.imageUpdatedAt,
          updatedAt: new Date(),
        })
        .where(eq(products.id, other.id));
      await tx.delete(products).where(eq(products.id, id));
      if (other.imageKey && product.imageKey)
        await this.forget(product.imageKey);
      return { id: other.id };
    });
  }

  /**
   * Removes it from "What you buy" and the suggested list. Its receipt lines
   * stay (they are part of what you paid), and so do new ones of that name.
   */
  async hide(id: string): Promise<void> {
    await this.find(id);
    await this.svc.db
      .update(products)
      .set({ hidden: true, updatedAt: new Date() })
      .where(eq(products.id, id));
  }

  /** Stores its photo (the request body) and replaces the one it had. */
  async upload(id: string, body: Readable): Promise<void> {
    const storage = await this.bucket();
    const product = await this.find(id);
    const { bytes, type, extension } = await readUploadedImage(body);
    const key = `products/${id}/photo-${randomUUID()}${extension}`;
    await storage.put(key, bytes, type);
    await this.svc.db
      .update(products)
      .set({ imageKey: key, imageType: type, imageUpdatedAt: new Date() })
      .where(eq(products.id, id));
    if (product.imageKey) await this.forget(product.imageKey);
  }

  async open(
    id: string,
  ): Promise<{ body: Readable; contentType: string; size?: number }> {
    const product = await this.find(id);
    if (!product.imageKey || !product.imageType)
      throw new NotFoundException('This item has no photo');
    const storage = await this.bucket();
    const object = await storage.getStream(product.imageKey);
    if (!object) throw new NotFoundException('The photo file is missing');
    return {
      body: object.body,
      contentType: product.imageType,
      size: object.sizeBytes,
    };
  }

  async removeImage(id: string): Promise<void> {
    const product = await this.find(id);
    await this.svc.db
      .update(products)
      .set({ imageKey: null, imageType: null, imageUpdatedAt: null })
      .where(eq(products.id, id));
    if (product.imageKey) await this.forget(product.imageKey);
  }

  /** Deletes a photo no item points to any more (a failure only leaves an orphan). */
  private async forget(key: string): Promise<void> {
    try {
      await this.storage?.delete(key);
    } catch (error) {
      this.log.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }

  private async find(id: string): Promise<ProductRow> {
    const [row] = await this.svc.db
      .select()
      .from(products)
      .where(eq(products.id, id));
    if (!row) throw new NotFoundException(`Item ${id} not found`);
    return row;
  }

  private async bucket(): Promise<ObjectStorage> {
    const storage = this.storage;
    if (!storage)
      throw new ServiceUnavailableException(
        'Product photos need the object storage: set S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY for svc-groceries',
      );
    this.ready ??= storage.ensureBucket().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    await this.ready;
    return storage;
  }
}
