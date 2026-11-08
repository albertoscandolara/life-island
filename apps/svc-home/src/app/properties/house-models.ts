import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  checkModel,
  MODEL_CONTENT_TYPES,
  ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import {
  MODEL_MAX_BYTES,
  modelFormatOf,
  type PropertyDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type HomeConfig } from '../config.js';
import { properties } from '../db/schema.js';
import { toPropertyDto } from './properties.service.js';

/**
 * The 3D model of each house, kept in this service's own bucket of the object
 * storage (never in the database). Uploads and downloads go through this
 * service, so the browser never needs access to the bucket.
 */
@Injectable()
export class HouseModels {
  private readonly log = new Logger(HouseModels.name);
  private readonly storage: ObjectStorage | null;
  private ready: Promise<void> | null = null;

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CONFIG) config: HomeConfig,
  ) {
    this.storage = config.storage ? new ObjectStorage(config.storage) : null;
  }

  async upload(
    id: string,
    filename: string,
    body: Readable,
  ): Promise<PropertyDto> {
    const storage = await this.bucket();
    const format = modelFormatOf(filename);
    if (!format)
      throw new BadRequestException(
        'Upload a .glb, .gltf (with embedded buffers) or .obj file',
      );
    const [property] = await this.svc.db
      .select()
      .from(properties)
      .where(eq(properties.id, id));
    if (!property) throw new NotFoundException(`Property ${id} not found`);

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += (chunk as Buffer).length;
      if (size > MODEL_MAX_BYTES)
        throw new PayloadTooLargeException(
          `A model can be at most ${MODEL_MAX_BYTES / 1024 / 1024} MB`,
        );
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) throw new BadRequestException('The file is empty');
    const problem = checkModel(format, bytes);
    if (problem) throw new BadRequestException(problem);

    const key = `properties/${id}/${randomUUID()}${format === 'GLB' ? '.glb' : format === 'GLTF' ? '.gltf' : '.obj'}`;
    await storage.put(key, bytes, MODEL_CONTENT_TYPES[format]);
    const [row] = await this.svc.db
      .update(properties)
      .set({
        modelKey: key,
        modelFilename: filename,
        modelFormat: format,
        modelSize: bytes.length,
        modelUploadedAt: new Date(),
      })
      .where(eq(properties.id, id))
      .returning();
    if (property.modelKey) await this.forget(property.modelKey);
    return toPropertyDto(row);
  }

  async open(
    id: string,
  ): Promise<{ body: Readable; contentType: string; size?: number }> {
    const [property] = await this.svc.db
      .select()
      .from(properties)
      .where(eq(properties.id, id));
    if (!property?.modelKey || !property.modelFormat)
      throw new NotFoundException('This house has no 3D model');
    const storage = await this.bucket();
    const object = await storage.getStream(property.modelKey);
    if (!object) throw new NotFoundException('The 3D model file is missing');
    return {
      body: object.body,
      contentType: MODEL_CONTENT_TYPES[property.modelFormat],
      size: object.sizeBytes,
    };
  }

  async remove(id: string): Promise<PropertyDto> {
    const [property] = await this.svc.db
      .select()
      .from(properties)
      .where(eq(properties.id, id));
    if (!property) throw new NotFoundException(`Property ${id} not found`);
    const [row] = await this.svc.db
      .update(properties)
      .set({
        modelKey: null,
        modelFilename: null,
        modelFormat: null,
        modelSize: null,
        modelUploadedAt: null,
      })
      .where(eq(properties.id, id))
      .returning();
    if (property.modelKey) await this.forget(property.modelKey);
    return toPropertyDto(row);
  }

  /** Deletes a model file no house points to any more (a failure only leaves an orphan). */
  async forget(key: string): Promise<void> {
    try {
      await this.storage?.delete(key);
    } catch (error) {
      this.log.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }

  private async bucket(): Promise<ObjectStorage> {
    const storage = this.storage;
    if (!storage)
      throw new ServiceUnavailableException(
        '3D models need the object storage: set S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY for svc-home',
      );
    this.ready ??= storage.ensureBucket().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    await this.ready;
    return storage;
  }
}
