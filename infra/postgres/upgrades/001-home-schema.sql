-- Adds the home schema and role (svc-home) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'home_svc') then
    create role home_svc login password 'dev_home';
  end if;
end $$;

grant connect on database life_island to home_svc;
create schema if not exists home authorization home_svc;
alter role home_svc set search_path = home;

set role home_svc;
create table if not exists home.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on home.outbox (created_at) where published_at is null;
create table if not exists home.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
