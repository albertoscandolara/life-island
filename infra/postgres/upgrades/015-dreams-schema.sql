-- Adds the dreams schema and role (svc-dreams) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'dreams_svc') then
    create role dreams_svc login password 'dev_dreams';
  end if;
end $$;

grant connect on database life_island to dreams_svc;
create schema if not exists dreams authorization dreams_svc;
alter role dreams_svc set search_path = dreams;

set role dreams_svc;
create table if not exists dreams.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on dreams.outbox (created_at) where published_at is null;
create table if not exists dreams.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
