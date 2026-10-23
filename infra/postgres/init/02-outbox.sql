-- Every service schema gets the transactional outbox and the idempotency table.
-- Tables are created as the owning role so the service can use them without grants.

create procedure pg_temp.create_outbox_tables(target_schema text, owner_role text)
language plpgsql as $$
begin
  execute format('set local role %I', owner_role);
  execute format($sql$
    create table %1$I.outbox (
      id           uuid primary key default gen_random_uuid(),
      event_type   text not null,
      payload      jsonb not null,
      created_at   timestamptz not null default now(),
      published_at timestamptz
    );
    create index outbox_unpublished_idx on %1$I.outbox (created_at) where published_at is null;
    create table %1$I.processed_events (
      event_id     uuid primary key,
      processed_at timestamptz not null default now()
    );
  $sql$, target_schema);
  reset role;
end $$;

begin;
call pg_temp.create_outbox_tables('ingestion', 'ingestion_svc');
call pg_temp.create_outbox_tables('review', 'review_svc');
call pg_temp.create_outbox_tables('grocery', 'grocery_svc');
call pg_temp.create_outbox_tables('tax730', 'tax730_svc');
commit;
