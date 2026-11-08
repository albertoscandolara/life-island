-- Adds the work schema and role (svc-work) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'work_svc') then
    create role work_svc login password 'dev_work';
  end if;
end $$;

grant connect on database life_island to work_svc;
create schema if not exists work authorization work_svc;
alter role work_svc set search_path = work;

set role work_svc;
create table if not exists work.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on work.outbox (created_at) where published_at is null;
create table if not exists work.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
