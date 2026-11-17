-- Adds the auth schema and role (svc-auth) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'auth_svc') then
    create role auth_svc login password 'dev_auth';
  end if;
end $$;

grant connect on database life_island to auth_svc;
create schema if not exists auth authorization auth_svc;
alter role auth_svc set search_path = auth;

set role auth_svc;
create table if not exists auth.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on auth.outbox (created_at) where published_at is null;
create table if not exists auth.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
