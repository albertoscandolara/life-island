-- Removes what is left of Goals & habits: its schema and its role. Their
-- data was moved into Dreams by 017-goals-into-dreams.sql, so this runs only
-- where that move is recorded (goals.moved_to_dreams); a database where the
-- move has not happened yet keeps the goals schema until it has.

do $$
begin
  if to_regclass('goals.goals') is not null
    and to_regclass('goals.moved_to_dreams') is null then
    raise notice 'Goals: not removed yet, its data has not been moved into Dreams. Start svc-dreams, then run npm run db:upgrade again.';
    return;
  end if;
  if exists (select from pg_namespace where nspname = 'goals') then
    set local client_min_messages = warning;
    drop schema goals cascade;
    reset client_min_messages;
  end if;
  if exists (select from pg_roles where rolname = 'goals_svc') then
    execute 'revoke all on database ' || quote_ident(current_database()) || ' from goals_svc';
    drop owned by goals_svc;
    drop role goals_svc;
    raise notice 'Goals: removed the goals schema and role.';
  end if;
end $$;
