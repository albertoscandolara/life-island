-- Moves Goals & habits into Dreams (the two areas were merged in November
-- 2026). Every goal becomes a dream with the same id, its steps become dream
-- steps, and its habits, their ticks and the weekly reviews move with them.
--
-- Runs once: when it is done it writes goals.moved_to_dreams, and later runs
-- skip, so a dream you delete afterwards does not come back. It needs the
-- dreams tables of svc-dreams 0001_habits_and_reviews: if svc-dreams has not
-- started since, it only says so, and the next `npm run db:upgrade` (or
-- svc-dreams itself, on your machine) does the move.
--
-- Nothing is deleted: the goals schema stays as it was, so you can check the
-- move, and only its role can no longer sign in (svc-goals is gone). Drop
-- both by hand when you are happy: `drop schema goals cascade; drop role
-- goals_svc;`.

do $$
declare
  moved_goals integer;
  moved_habits integer;
  moved_reviews integer;
begin
  if to_regclass('goals.goals') is null then
    return; -- a database made after the merge: nothing to move.
  end if;
  if to_regclass('goals.moved_to_dreams') is not null then
    return;
  end if;
  if to_regclass('dreams.habits') is null
    or to_regclass('dreams.weekly_reviews') is null then
    raise notice 'Goals into Dreams: start svc-dreams once (it adds the habits tables), then run npm run db:upgrade again.';
    return;
  end if;

  -- A goal becomes a dream. Active ones with steps are "taking steps".
  insert into dreams.dreams (
    id, title, area, why, measure, target_date, pace, status,
    context_areas, created_at, updated_at
  )
  select
    g.id,
    g.title,
    case g.area
      when 'health' then 'fitness'
      when 'career' then 'work'
      when 'money' then 'money'
      when 'learning' then 'learning'
      when 'relationships' then 'relationships'
      when 'home' then 'home'
      when 'mind' then 'wellbeing'
      when 'fun' then 'creativity'
      else 'other'
    end,
    g.why,
    g.measure,
    g.target_date,
    'steady',
    case g.status
      when 'paused' then 'paused'
      when 'done' then 'reached'
      when 'dropped' then 'let-go'
      else case
        when exists (select from goals.goal_steps s where s.goal_id = g.id)
          then 'moving'
        else 'dreaming'
      end
    end,
    '[]'::jsonb,
    g.created_at,
    g.updated_at
  from goals.goals g
  on conflict (id) do nothing;
  get diagnostics moved_goals = row_count;

  -- Open steps are chosen; steps done in Goals keep their day and are
  -- marked as coming from Goals, so they do not ask for a check-in.
  insert into dreams.dream_steps (
    id, dream_id, title, kind, stretch, status, due_date, done_on, source,
    created_at
  )
  select
    s.id,
    s.goal_id,
    s.title,
    'prepare',
    'tiny',
    case when s.done then 'done' else 'chosen' end,
    s.due_date,
    case when s.done then coalesce(s.done_on, s.created_at::date) end,
    case when s.done then 'goals' else 'you' end,
    s.created_at
  from goals.goal_steps s
  on conflict (id) do nothing;

  insert into dreams.habits (id, title, dream_id, per_week, active, created_at)
  select h.id, h.title, h.goal_id, h.per_week, h.active, h.created_at
  from goals.habits h
  on conflict (id) do nothing;
  get diagnostics moved_habits = row_count;

  insert into dreams.habit_checks (habit_id, date)
  select c.habit_id, c.date
  from goals.habit_checks c
  on conflict do nothing;

  insert into dreams.weekly_reviews (
    id, week_start, mood, wins, stuck, next, created_at
  )
  select r.id, r.week_start, r.mood, r.wins, r.stuck, r.next, r.created_at
  from goals.weekly_reviews r
  on conflict do nothing;
  get diagnostics moved_reviews = row_count;

  create table goals.moved_to_dreams (
    moved_at timestamptz primary key default now(),
    goals integer not null,
    habits integer not null,
    reviews integer not null
  );
  insert into goals.moved_to_dreams (goals, habits, reviews)
  values (moved_goals, moved_habits, moved_reviews);
  if exists (select from pg_roles where rolname = 'goals_svc') then
    alter role goals_svc nologin;
  end if;
  raise notice 'Goals into Dreams: moved goals %, habits %, weekly reviews %.',
    moved_goals, moved_habits, moved_reviews;
end $$;
