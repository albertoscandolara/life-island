import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

export interface StorageOptions {
  /** S3 API endpoint the services use, e.g. `http://localhost:8333` (SeaweedFS) or the R2 endpoint. */
  endpoint: string;
  /** Endpoint the browser can reach, used to sign presigned URLs; defaults to `endpoint`. */
  publicEndpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface StoredObjectHead {
  sizeBytes: number;
  contentType?: string;
}

/**
 * Thin wrapper over the S3 API. SeaweedFS locally and Cloudflare R2 in
 * production speak the same protocol, so only the endpoint and keys change.
 */
export class ObjectStorage {
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(options: StorageOptions) {
    this.bucket = options.bucket;
    const base = {
      region: options.region ?? 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      // Presigned PUTs must not carry a checksum the browser cannot compute.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: options.endpoint });
    this.signer = new S3Client({
      ...base,
      endpoint: options.publicEndpoint ?? options.endpoint,
    });
  }

  /** Creates the bucket if needed and lets the given browser origins PUT and GET. */
  async ensureBucket(allowedOrigins: string[] = []): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    if (allowedOrigins.length > 0) {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: allowedOrigins,
                AllowedMethods: ['PUT', 'GET', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    }
  }

  presignPut(
    key: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(['content-type']),
      },
    );
  }

  presignGet(
    key: string,
    options: {
      filename?: string;
      contentType?: string;
      expiresInSeconds?: number;
    } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: options.filename
          ? `inline; filename*=UTF-8''${encodeURIComponent(options.filename)}`
          : undefined,
      }),
      { expiresIn: options.expiresInSeconds ?? 300 },
    );
  }

  async head(key: string): Promise<StoredObjectHead | undefined> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: head.ContentLength ?? 0,
        contentType: head.ContentType,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') return undefined;
      throw error;
    }
  }

  async getBytes(key: string): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!object.Body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await object.Body.transformToByteArray());
  }

  /** Streams one object, for services that serve files with their own headers. */
  async getStream(
    key: string,
  ): Promise<{ body: Readable; sizeBytes?: number } | undefined> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!object.Body) return undefined;
      return {
        body: object.Body as Readable,
        sizeBytes: object.ContentLength,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return undefined;
      throw error;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/** Reads the storage settings shared by every service from the environment. */
export function storageOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StorageOptions {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  };
  return {
    endpoint: required('S3_ENDPOINT'),
    publicEndpoint: env['S3_PUBLIC_ENDPOINT'] || undefined,
    region: env['S3_REGION'] || 'us-east-1',
    accessKeyId: required('S3_ACCESS_KEY'),
    secretAccessKey: required('S3_SECRET_KEY'),
    bucket: env['S3_BUCKET'] || 'uploads',
  };
}
