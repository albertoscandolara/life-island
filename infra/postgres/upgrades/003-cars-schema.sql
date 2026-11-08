-- Adds the cars schema and role (svc-cars) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'cars_svc') then
    create role cars_svc login password 'dev_cars';
  end if;
end $$;

grant connect on database life_island to cars_svc;
create schema if not exists cars authorization cars_svc;
alter role cars_svc set search_path = cars;

set role cars_svc;
create table if not exists cars.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on cars.outbox (created_at) where published_at is null;
create table if not exists cars.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
