-- Parsed documents never told the other modules what the AI read: the parse
-- worker sent `upload.updated` when the categories were known, but not after
-- extracting the fields, so Work, Houses, People, Cars and the 730 kept the
-- fields empty until you saved the document by hand (e.g. payslips missing
-- from Work's pay statistics). The worker now sends it when a document is
-- parsed; this replays the current snapshot of every parsed document once.
-- Consumers keep the newest snapshot by `updatedAt`, so replaying is safe.
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
         'fields', coalesce(
           (select jsonb_object_agg(f.key, coalesce(f.value -> 'value', 'null'::jsonb))
              from jsonb_each(u.extracted_fields -> 'fields') as f),
           '{}'::jsonb),
         'historicalStatus', u.historical_status,
         'historicalSuggestions', coalesce(
           (select jsonb_agg(h ->> 'categoryId')
              from jsonb_array_elements(u.historical_suggestions) as h),
           '[]'::jsonb),
         'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  from ingestion.uploads u
 where u.status = 'PARSED'
   and u.file_format is not null
   and u.extracted_fields is not null;
