create table public.energy_media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  kind text not null check (kind in ('presenter','video','image','website_capture','gif')),
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_bucket text not null default 'energy-media',
  storage_path text not null,
  label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, storage_path)
);

create table public.energy_studio_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  scope text not null default 'global' check (scope in ('global','lead')),
  template_key text not null default 'pv-gewerbe',
  name text not null default 'Walkenhorst Studio',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='global' and lead_id is null) or (scope='lead' and lead_id is not null))
);

create unique index energy_studio_configs_scope_uidx
  on public.energy_studio_configs(user_id, scope, coalesce(lead_id,'00000000-0000-0000-0000-000000000000'::uuid), template_key);
create index energy_media_assets_user_created_idx on public.energy_media_assets(user_id, created_at desc);
create index energy_studio_configs_user_lead_idx on public.energy_studio_configs(user_id, lead_id);

alter table public.energy_video_pages
  add column studio_config jsonb not null default '{}'::jsonb,
  add column website_capture_url text,
  add column accent_color text not null default '#17945c',
  add column template_key text not null default 'pv-gewerbe',
  add column thumbnail_url text;

alter table public.energy_media_assets enable row level security;
alter table public.energy_studio_configs enable row level security;

grant select,insert,update,delete on public.energy_media_assets to authenticated;
grant select,insert,update,delete on public.energy_studio_configs to authenticated;

create policy energy_media_assets_select_own on public.energy_media_assets for select to authenticated using ((select auth.uid()) = user_id);
create policy energy_media_assets_insert_own on public.energy_media_assets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy energy_media_assets_update_own on public.energy_media_assets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy energy_media_assets_delete_own on public.energy_media_assets for delete to authenticated using ((select auth.uid()) = user_id);

create policy energy_studio_configs_select_own on public.energy_studio_configs for select to authenticated using ((select auth.uid()) = user_id);
create policy energy_studio_configs_insert_own on public.energy_studio_configs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy energy_studio_configs_update_own on public.energy_studio_configs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy energy_studio_configs_delete_own on public.energy_studio_configs for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('energy-media','energy-media',true,104857600,array['video/mp4','video/webm','image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update
set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists energy_media_insert_own on storage.objects;
create policy energy_media_insert_own on storage.objects for insert to authenticated
with check (bucket_id='energy-media' and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists energy_media_select_own on storage.objects;
create policy energy_media_select_own on storage.objects for select to authenticated
using (bucket_id='energy-media' and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists energy_media_update_own on storage.objects;
create policy energy_media_update_own on storage.objects for update to authenticated
using (bucket_id='energy-media' and (storage.foldername(name))[1]=(select auth.uid()::text))
with check (bucket_id='energy-media' and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists energy_media_delete_own on storage.objects;
create policy energy_media_delete_own on storage.objects for delete to authenticated
using (bucket_id='energy-media' and (storage.foldername(name))[1]=(select auth.uid()::text));
