-- Adds the people schema and role (svc-people) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'people_svc') then
    create role people_svc login password 'dev_people';
  end if;
end $$;

grant connect on database life_island to people_svc;
create schema if not exists people authorization people_svc;
alter role people_svc set search_path = people;

set role people_svc;
create table if not exists people.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on people.outbox (created_at) where published_at is null;
create table if not exists people.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
