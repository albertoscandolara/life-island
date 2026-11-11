-- Adds the money schema and role (svc-money) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'money_svc') then
    create role money_svc login password 'dev_money';
  end if;
end $$;

grant connect on database life_island to money_svc;
create schema if not exists money authorization money_svc;
alter role money_svc set search_path = money;

set role money_svc;
create table if not exists money.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on money.outbox (created_at) where published_at is null;
create table if not exists money.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
