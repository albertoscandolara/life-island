-- Adds the travel schema and role (svc-travel) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'travel_svc') then
    create role travel_svc login password 'dev_travel';
  end if;
end $$;

grant connect on database life_island to travel_svc;
create schema if not exists travel authorization travel_svc;
alter role travel_svc set search_path = travel;

set role travel_svc;
create table if not exists travel.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on travel.outbox (created_at) where published_at is null;
create table if not exists travel.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
