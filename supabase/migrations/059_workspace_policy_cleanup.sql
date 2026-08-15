-- After 058_shared_workspace.sql the workspace policies fully replace the former per-user policies.
-- Keeping both sets is functionally correct but causes every authenticated query to evaluate duplicate permissive policies.

do $$
declare r record;
begin
  for r in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename like 'energy_%'
      and 'authenticated'=any(roles)
      and policyname not like 'workspace %'
  loop
    execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  end loop;
end $$;

-- Storage follows the same shared-workspace rule, including legacy member folders.
drop policy if exists energy_media_delete_own on storage.objects;
drop policy if exists energy_media_insert_own on storage.objects;
drop policy if exists energy_media_select_own on storage.objects;
drop policy if exists energy_media_update_own on storage.objects;
