-- Adds the studies schema and role (svc-studies) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'studies_svc') then
    create role studies_svc login password 'dev_studies';
  end if;
end $$;

grant connect on database life_island to studies_svc;
create schema if not exists studies authorization studies_svc;
alter role studies_svc set search_path = studies;

set role studies_svc;
create table if not exists studies.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on studies.outbox (created_at) where published_at is null;
create table if not exists studies.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
