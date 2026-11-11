-- Adds the goals schema and role (svc-goals) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'goals_svc') then
    create role goals_svc login password 'dev_goals';
  end if;
end $$;

grant connect on database life_island to goals_svc;
create schema if not exists goals authorization goals_svc;
alter role goals_svc set search_path = goals;

set role goals_svc;
create table if not exists goals.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on goals.outbox (created_at) where published_at is null;
create table if not exists goals.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
