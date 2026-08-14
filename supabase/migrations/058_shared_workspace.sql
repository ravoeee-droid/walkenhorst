-- Shared Walkenhorst workspace: multiple authenticated logins operate on one owner data set.
-- Membership rows are operational data and intentionally not seeded in this migration.

create table if not exists public.energy_workspace_members (
  user_id uuid primary key,
  workspace_owner_id uuid not null,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.energy_workspace_members enable row level security;
revoke all on public.energy_workspace_members from anon;
grant select on public.energy_workspace_members to authenticated;

drop policy if exists "workspace member reads own membership" on public.energy_workspace_members;
create policy "workspace member reads own membership"
on public.energy_workspace_members for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.energy_workspace_owner_id()
returns uuid
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select wm.workspace_owner_id from public.energy_workspace_members wm where wm.user_id=(select auth.uid()) limit 1),
    (select auth.uid())
  );
$$;

create or replace function public.energy_has_workspace_access(p_owner uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$ select p_owner = public.energy_workspace_owner_id(); $$;

revoke all on function public.energy_workspace_owner_id() from public;
revoke all on function public.energy_has_workspace_access(uuid) from public;
grant execute on function public.energy_workspace_owner_id() to authenticated, service_role;
grant execute on function public.energy_has_workspace_access(uuid) to authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.energy_member_in_current_workspace(p_member text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.energy_workspace_members wm
      where wm.user_id::text = p_member
        and wm.workspace_owner_id = public.energy_workspace_owner_id()
    );
$$;
revoke all on function private.energy_member_in_current_workspace(text) from public;
grant execute on function private.energy_member_in_current_workspace(text) to authenticated, service_role;

create or replace function public.energy_has_workspace_access_text(p_owner text)
returns boolean
language sql
stable
security invoker
set search_path = public, private, pg_catalog
as $$
  select p_owner = public.energy_workspace_owner_id()::text
      or private.energy_member_in_current_workspace(p_owner);
$$;
revoke all on function public.energy_has_workspace_access_text(text) from public;
grant execute on function public.energy_has_workspace_access_text(text) to authenticated, service_role;

-- Direct workspace-owned tables.
do $$
declare t text;
begin
  foreach t in array array[
    'energy_activities','energy_alerts','energy_bounces','energy_brand_kits','energy_call_events','energy_calls',
    'energy_campaign_variants','energy_campaigns','energy_deal_stage_events','energy_deals','energy_documents','energy_followups',
    'energy_integrations','energy_lead_searches','energy_leads','energy_mailboxes','energy_media_assets','energy_messages',
    'energy_render_jobs','energy_runtime_settings','energy_site_intelligence','energy_studio_configs','energy_studio_versions',
    'energy_suppressions','energy_templates','energy_video_pages'
  ] loop
    execute format('drop policy if exists %I on public.%I','workspace shared full access',t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.energy_has_workspace_access(user_id)) with check (public.energy_has_workspace_access(user_id))',
      'workspace shared full access',t
    );
  end loop;
end $$;

-- Browser read-only workspace tables.
do $$
declare t text;
begin
  foreach t in array array['energy_automation_outbox','energy_intent_events','energy_qualifications','energy_webhook_tokens'] loop
    execute format('drop policy if exists %I on public.%I','workspace shared read access',t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.energy_has_workspace_access(user_id))',
      'workspace shared read access',t
    );
  end loop;
end $$;

-- Child rows inherit workspace ownership from their parent.
drop policy if exists "workspace campaign members full access" on public.energy_campaign_members;
create policy "workspace campaign members full access" on public.energy_campaign_members for all to authenticated
using (exists(select 1 from public.energy_campaigns c where c.id=campaign_id and public.energy_has_workspace_access(c.user_id)))
with check (exists(select 1 from public.energy_campaigns c where c.id=campaign_id and public.energy_has_workspace_access(c.user_id)));

drop policy if exists "workspace campaign steps full access" on public.energy_campaign_steps;
create policy "workspace campaign steps full access" on public.energy_campaign_steps for all to authenticated
using (exists(select 1 from public.energy_campaigns c where c.id=campaign_id and public.energy_has_workspace_access(c.user_id)))
with check (exists(select 1 from public.energy_campaigns c where c.id=campaign_id and public.energy_has_workspace_access(c.user_id)));

drop policy if exists "workspace email events read access" on public.energy_email_events;
create policy "workspace email events read access" on public.energy_email_events for select to authenticated
using (exists(select 1 from public.energy_messages m where m.id=message_id and public.energy_has_workspace_access(m.user_id)));

drop policy if exists "workspace video events read access" on public.energy_video_events;
create policy "workspace video events read access" on public.energy_video_events for select to authenticated
using (exists(select 1 from public.energy_video_pages p where p.id=video_page_id and public.energy_has_workspace_access(p.user_id)));

drop policy if exists "workspace video events insert access" on public.energy_video_events;
create policy "workspace video events insert access" on public.energy_video_events for insert to authenticated
with check (exists(select 1 from public.energy_video_pages p where p.id=video_page_id and public.energy_has_workspace_access(p.user_id)));

-- Storage remains a single logical library. Legacy member folders stay accessible to workspace members.
drop policy if exists "energy_media_workspace_select" on storage.objects;
create policy "energy_media_workspace_select" on storage.objects for select to authenticated
using (bucket_id='energy-media' and public.energy_has_workspace_access_text((storage.foldername(name))[1]));
drop policy if exists "energy_media_workspace_insert" on storage.objects;
create policy "energy_media_workspace_insert" on storage.objects for insert to authenticated
with check (bucket_id='energy-media' and public.energy_has_workspace_access_text((storage.foldername(name))[1]));
drop policy if exists "energy_media_workspace_update" on storage.objects;
create policy "energy_media_workspace_update" on storage.objects for update to authenticated
using (bucket_id='energy-media' and public.energy_has_workspace_access_text((storage.foldername(name))[1]))
with check (bucket_id='energy-media' and public.energy_has_workspace_access_text((storage.foldername(name))[1]));
drop policy if exists "energy_media_workspace_delete" on storage.objects;
create policy "energy_media_workspace_delete" on storage.objects for delete to authenticated
using (bucket_id='energy-media' and public.energy_has_workspace_access_text((storage.foldername(name))[1]));

-- Existing browser RPCs must resolve auth.uid() to the shared owner.
do $$
declare r record; def text;
begin
  for r in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'energy_add_suppression','energy_alert_action','energy_disable_suppression','energy_find_duplicate_leads',
      'energy_merge_leads','energy_record_call_outcome','energy_revival_candidates','energy_revive_lead',
      'energy_sales_brief','energy_sales_priority_v2'
    )
  loop
    def := pg_get_functiondef(r.oid);
    def := replace(def,'(select auth.uid())','public.energy_workspace_owner_id()');
    def := replace(def,'( SELECT auth.uid() AS uid)','public.energy_workspace_owner_id()');
    def := replace(def,'auth.uid()','public.energy_workspace_owner_id()');
    execute def;
  end loop;
end $$;
