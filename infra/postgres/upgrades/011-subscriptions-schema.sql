-- Adds the subscriptions schema and role (svc-subscriptions) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'subscriptions_svc') then
    create role subscriptions_svc login password 'dev_subscriptions';
  end if;
end $$;

grant connect on database life_island to subscriptions_svc;
create schema if not exists subscriptions authorization subscriptions_svc;
alter role subscriptions_svc set search_path = subscriptions;

set role subscriptions_svc;
create table if not exists subscriptions.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on subscriptions.outbox (created_at) where published_at is null;
create table if not exists subscriptions.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
