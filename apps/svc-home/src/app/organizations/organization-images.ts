import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectStorage, type ServiceDb } from '@life-island/be-common';
import {
  ORGANIZATION_IMAGE_MAX_BYTES,
  type OrganizationImageKind,
  type OrganizationImageType,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type HomeConfig } from '../config.js';
import { organizations, type OrganizationRow } from '../db/schema.js';

const EXTENSIONS: Record<OrganizationImageType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * The image type from the file's first bytes, whatever its name or the
 * browser says: only PNG, JPEG, WebP and GIF, never SVG or HTML.
 */
export function imageTypeOf(bytes: Uint8Array): OrganizationImageType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (from: number, text: string) =>
    [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

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

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += (chunk as Buffer).length;
      if (size > ORGANIZATION_IMAGE_MAX_BYTES)
        throw new PayloadTooLargeException(
          `An image can be at most ${ORGANIZATION_IMAGE_MAX_BYTES / 1024 / 1024} MB`,
        );
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) throw new BadRequestException('The file is empty');
    const type = imageTypeOf(bytes);
    if (!type)
      throw new BadRequestException('Upload a PNG, JPEG, WebP or GIF image');

    const col = columns(kind);
    const key = `organizations/${id}/${kind}-${randomUUID()}${EXTENSIONS[type]}`;
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
