/*
 * Pictures you upload to a record (a company's logo, a product's photo): the
 * types a service accepts and how large they can be. Each service keeps them
 * in its own bucket, never in the database.
 */

/** Image types accepted (no SVG: it can carry scripts). */
export const UPLOAD_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export type UploadImageType = (typeof UPLOAD_IMAGE_TYPES)[number];
/** Largest image accepted, in bytes. */
export const UPLOAD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
