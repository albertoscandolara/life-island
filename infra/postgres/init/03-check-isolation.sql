-- Verifies the Week 1 "done" rule: each service role sees only its own schema.
-- Run it any time with: npm run db:check-isolation
-- It raises an exception (non-zero exit) on the first leak it finds.

do $$
declare
  roles   text[] := array['ingestion_svc', 'review_svc', 'grocery_svc', 'tax730_svc'];
  schemas text[] := array['ingestion', 'review', 'grocery', 'tax730'];
  i int;
  j int;
begin
  for i in 1 .. array_length(roles, 1) loop
    for j in 1 .. array_length(schemas, 1) loop
      if i = j then
        if not has_schema_privilege(roles[i], schemas[j], 'USAGE')
           or not has_table_privilege(roles[i], schemas[j] || '.outbox', 'INSERT') then
          raise exception '% cannot use its own schema %', roles[i], schemas[j];
        end if;
      elsif has_schema_privilege(roles[i], schemas[j], 'USAGE')
         or has_schema_privilege(roles[i], schemas[j], 'CREATE') then
        raise exception 'LEAK: % can access schema %', roles[i], schemas[j];
      end if;
    end loop;
    if has_schema_privilege(roles[i], 'public', 'CREATE') then
      raise exception 'LEAK: % can create objects in public', roles[i];
    end if;
  end loop;
  raise notice 'isolation ok: % roles, each limited to its own schema', array_length(roles, 1);
end $$;
