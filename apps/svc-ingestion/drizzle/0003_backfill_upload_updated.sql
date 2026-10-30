-- Tell the review inbox the categories of documents parsed before
-- `upload.updated@1` existed: one snapshot event per stored document, sent
-- through the outbox like any other.
insert into ingestion.outbox (event_type, payload)
select 'upload.updated@1',
       jsonb_build_object(
         'uploadId', u.id,
         'title', u.title,
         'description', u.description,
         'originalFilename', u.original_filename,
         'fileFormat', u.file_format,
         'uploadedAt', to_char(coalesce(u.uploaded_at, u.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'categories', to_jsonb(u.categories),
         'suggestedCategories', coalesce(
           (select jsonb_agg(s.category_id order by s.created_at)
              from ingestion.category_suggestions s
             where s.status = 'PENDING' and u.id = any(s.upload_ids)),
           '[]'::jsonb),
         'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  from ingestion.uploads u
 where u.status <> 'UPLOADING'
   and u.file_format is not null;
