import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectStorage, type ServiceDb } from '@life-island/be-common';
import { readUploadedImage } from '@life-island/be-nest';
import {
  ORGANIZATION_IMAGE_MAX_BYTES,
  type OrganizationImageKind,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type HomeConfig } from '../config.js';
import { organizations, type OrganizationRow } from '../db/schema.js';

const columns = (kind: OrganizationImageKind) =>
  kind === 'logo'
    ? ({ key: 'logoKey', type: 'logoType', at: 'logoUpdatedAt' } as const)
    : ({ key: 'coverKey', type: 'coverType', at: 'coverUpdatedAt' } as const);

/**
 * A company's logo and background image, kept in this service's bucket of
 * the object storage (never in the database), next to the houses' 3D models.
 * Uploads and downloads go through this service, so the browser never needs
 * access to the bucket.
 */
@Injectable()
export class OrganizationImages {
  private readonly log = new Logger(OrganizationImages.name);
  private readonly storage: ObjectStorage | null;
  private ready: Promise<void> | null = null;

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CONFIG) config: HomeConfig,
  ) {
    this.storage = config.storage ? new ObjectStorage(config.storage) : null;
  }

  /** Stores the image (the request body) and replaces the one it had. */
  async upload(
    id: string,
    kind: OrganizationImageKind,
    body: Readable,
  ): Promise<void> {
    const storage = await this.bucket();
    const company = await this.find(id);

    const { bytes, type, extension } = await readUploadedImage(
      body,
      ORGANIZATION_IMAGE_MAX_BYTES,
    );

    const col = columns(kind);
    const key = `organizations/${id}/${kind}-${randomUUID()}${extension}`;
    await storage.put(key, bytes, type);
    await this.svc.db
      .update(organizations)
      .set({ [col.key]: key, [col.type]: type, [col.at]: new Date() })
      .where(eq(organizations.id, id));
    const previous = company[col.key];
    if (previous) await this.forget(previous);
  }

  async open(
    id: string,
    kind: OrganizationImageKind,
  ): Promise<{ body: Readable; contentType: string; size?: number }> {
    const company = await this.find(id);
    const col = columns(kind);
    const key = company[col.key];
    const type = company[col.type];
    if (!key || !type)
      throw new NotFoundException(`This company has no ${kind} image`);
    const storage = await this.bucket();
    const object = await storage.getStream(key);
    if (!object) throw new NotFoundException('The image file is missing');
    return { body: object.body, contentType: type, size: object.sizeBytes };
  }

  async remove(id: string, kind: OrganizationImageKind): Promise<void> {
    const company = await this.find(id);
    const col = columns(kind);
    await this.svc.db
      .update(organizations)
      .set({ [col.key]: null, [col.type]: null, [col.at]: null })
      .where(eq(organizations.id, id));
    const previous = company[col.key];
    if (previous) await this.forget(previous);
  }

  /** Deletes an image no company points to any more (a failure only leaves an orphan). */
  async forget(key: string): Promise<void> {
    try {
      await this.storage?.delete(key);
    } catch (error) {
      this.log.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }

  private async find(id: string): Promise<OrganizationRow> {
    const [company] = await this.svc.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    if (!company) throw new NotFoundException(`Organization ${id} not found`);
    return company;
  }

  private async bucket(): Promise<ObjectStorage> {
    const storage = this.storage;
    if (!storage)
      throw new ServiceUnavailableException(
        'Company images need the object storage: set S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY for svc-home',
      );
    this.ready ??= storage.ensureBucket().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    await this.ready;
    return storage;
  }
}
