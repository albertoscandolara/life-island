-- Adds the mailbox schema and role (svc-mailbox) to a database created before it
-- existed. Safe to run any number of times: `npm run db:upgrade`.
-- A fresh volume gets the same through init/01 and init/02.

do $$
begin
  if not exists (select from pg_roles where rolname = 'mailbox_svc') then
    create role mailbox_svc login password 'dev_mailbox';
  end if;
end $$;

grant connect on database life_island to mailbox_svc;
create schema if not exists mailbox authorization mailbox_svc;
alter role mailbox_svc set search_path = mailbox;

set role mailbox_svc;
create table if not exists mailbox.outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on mailbox.outbox (created_at) where published_at is null;
create table if not exists mailbox.processed_events (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
reset role;
