-- Adds the settings schema and role (svc-settings) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'settings_svc') then
    create role settings_svc login password 'dev_settings';
  end if;
end $$;

grant connect on database life_island to settings_svc;
create schema if not exists settings authorization settings_svc;
alter role settings_svc set search_path = settings;

set role settings_svc;
create table if not exists settings.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on settings.outbox (created_at) where published_at is null;
create table if not exists settings.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
