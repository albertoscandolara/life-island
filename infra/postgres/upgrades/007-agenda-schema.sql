-- Adds the agenda schema and role (svc-agenda) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'agenda_svc') then
    create role agenda_svc login password 'dev_agenda';
  end if;
end $$;

grant connect on database life_island to agenda_svc;
create schema if not exists agenda authorization agenda_svc;
alter role agenda_svc set search_path = agenda;

set role agenda_svc;
create table if not exists agenda.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on agenda.outbox (created_at) where published_at is null;
create table if not exists agenda.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
