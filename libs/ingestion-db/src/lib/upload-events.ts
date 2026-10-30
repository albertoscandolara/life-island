import { enqueueEvent } from '@life-island/be-common';
import {
  UPLOAD_UPDATED_EVENT,
  type FileFormat,
  type UploadUpdatedV1,
} from '@life-island/contracts';
import type pg from 'pg';

interface SnapshotRow {
  id: string;
  title: string;
  description: string | null;
  original_filename: string;
  file_format: FileFormat;
  uploaded_at: Date;
  categories: string[];
  suggested: string[];
  now: Date;
}

/**
 * Adds one `upload.updated` event per document to the outbox, with the
 * document's current title, description, categories and pending category
 * suggestions. Call it in the transaction that changed any of them, after the
 * change, so the snapshot is what was committed. Uploads whose file never
 * made it (still uploading, or rejected) are skipped: nothing downstream knows them.
 */
export async function enqueueUploadUpdated(
  client: pg.ClientBase,
  schema: string,
  uploadIds: readonly string[],
): Promise<void> {
  if (!uploadIds.length) return;
  const { rows } = await client.query<SnapshotRow>(
    `select u.id, u.title, u.description, u.original_filename, u.file_format,
            coalesce(u.uploaded_at, u.created_at) as uploaded_at, u.categories,
            coalesce((select array_agg(s.category_id order by s.created_at)
                        from ingestion.category_suggestions s
                       where s.status = 'PENDING' and u.id = any(s.upload_ids)),
                     '{}') as suggested,
            clock_timestamp() as now
       from ingestion.uploads u
      where u.id = any($1::uuid[])
        and u.status <> 'UPLOADING'
        and u.file_format is not null
      order by u.id`,
    [[...new Set(uploadIds)]],
  );
  for (const row of rows) {
    const event: UploadUpdatedV1 = {
      uploadId: row.id,
      title: row.title,
      description: row.description,
      originalFilename: row.original_filename,
      fileFormat: row.file_format,
      uploadedAt: row.uploaded_at.toISOString(),
      categories: row.categories,
      suggestedCategories: row.suggested,
      updatedAt: row.now.toISOString(),
    };
    await enqueueEvent(client, schema, {
      type: UPLOAD_UPDATED_EVENT,
      payload: event,
    });
  }
}
