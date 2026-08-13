alter table public.energy_media_assets drop constraint if exists energy_media_assets_kind_check;
alter table public.energy_media_assets add constraint energy_media_assets_kind_check check (kind in ('presenter','video','image','website_capture','gif','audio','logo','map','render','overlay'));

create table public.energy_brand_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Walkenhorst Energie',
  website_url text,
  logo_url text,
  logo_asset_id uuid references public.energy_media_assets(id) on delete set null,
  favicon_url text,
  portrait_url text,
  portrait_asset_id uuid references public.energy_media_assets(id) on delete set null,
  primary_color text not null default '#111111',
  secondary_color text not null default '#F4F1EA',
  accent_color text not null default '#D9A928',
  background_color text not null default '#FFFFFF',
  surface_color text not null default '#F7F5F0',
  text_color text not null default '#151515',
  muted_text_color text not null default '#6F716F',
  button_text_color text not null default '#FFFFFF',
  font_heading text not null default 'Arial, Helvetica, sans-serif',
  font_body text not null default 'Arial, Helvetica, sans-serif',
  radius_px smallint not null default 12 check (radius_px between 0 and 40),
  shadow_style text not null default 'soft' check (shadow_style in ('none','soft','strong')),
  default_cta_label text not null default 'Kostenloses Erstgespräch anfragen',
  default_cta_url text not null default 'https://walkenhorst-energie.de/kontakt',
  trust_headline text not null default 'Ihre Energiezukunft ist meine Expertise.',
  trust_body text not null default 'Persönliche Energieberatung mit über 30 Jahren Beratungserfahrung und 10 Jahren Spezialisierung auf die Energiebranche.',
  contact_name text not null default 'Andreas Walkenhorst',
  contact_phone text,
  contact_email text,
  metadata jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index energy_brand_kits_default_uidx on public.energy_brand_kits(user_id) where is_default;
create index energy_brand_kits_user_idx on public.energy_brand_kits(user_id, updated_at desc);

alter table public.energy_studio_configs
  add column brand_kit_id uuid references public.energy_brand_kits(id) on delete set null,
  add column autosave_revision integer not null default 0,
  add column published_revision integer not null default 0,
  add column last_autosaved_at timestamptz,
  add column landing_enabled boolean not null default true;
create index energy_studio_configs_brand_kit_idx on public.energy_studio_configs(brand_kit_id) where brand_kit_id is not null;

create table public.energy_studio_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_config_id uuid not null references public.energy_studio_configs(id) on delete cascade,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  change_note text,
  created_at timestamptz not null default now(),
  unique(studio_config_id, revision)
);
create index energy_studio_versions_user_idx on public.energy_studio_versions(user_id, studio_config_id, revision desc);

create table public.energy_render_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_config_id uuid not null references public.energy_studio_configs(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete set null,
  video_page_id uuid references public.energy_video_pages(id) on delete set null,
  format text not null default 'mp4' check (format in ('mp4','webm')),
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9','9:16','1:1','4:5')),
  width integer not null default 1920 check (width between 320 and 3840),
  height integer not null default 1080 check (height between 320 and 3840),
  fps smallint not null default 30 check (fps between 15 and 60),
  status text not null default 'queued' check (status in ('queued','preparing','rendering','encoding','uploading','completed','failed','cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  render_engine text not null default 'browser',
  output_bucket text,
  output_path text,
  output_url text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index energy_render_jobs_user_idx on public.energy_render_jobs(user_id, created_at desc);
create index energy_render_jobs_config_idx on public.energy_render_jobs(studio_config_id, created_at desc);
create index energy_render_jobs_lead_idx on public.energy_render_jobs(lead_id) where lead_id is not null;
create index energy_render_jobs_page_idx on public.energy_render_jobs(video_page_id) where video_page_id is not null;

alter table public.energy_video_pages
  add column timeline_v3 jsonb not null default '{}'::jsonb,
  add column landing_config jsonb not null default '{}'::jsonb,
  add column brand_kit_snapshot jsonb not null default '{}'::jsonb,
  add column rendered_video_url text,
  add column rendered_video_format text check (rendered_video_format is null or rendered_video_format in ('mp4','webm')),
  add column rendered_at timestamptz,
  add column studio_revision integer not null default 0;

alter table public.energy_brand_kits enable row level security;
alter table public.energy_studio_versions enable row level security;
alter table public.energy_render_jobs enable row level security;

grant select,insert,update,delete on public.energy_brand_kits to authenticated;
grant select,insert,update,delete on public.energy_studio_versions to authenticated;
grant select,insert,update,delete on public.energy_render_jobs to authenticated;

create policy energy_brand_kits_select_own on public.energy_brand_kits for select to authenticated using ((select auth.uid())=user_id);
create policy energy_brand_kits_insert_own on public.energy_brand_kits for insert to authenticated with check ((select auth.uid())=user_id);
create policy energy_brand_kits_update_own on public.energy_brand_kits for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy energy_brand_kits_delete_own on public.energy_brand_kits for delete to authenticated using ((select auth.uid())=user_id);

create policy energy_studio_versions_select_own on public.energy_studio_versions for select to authenticated using ((select auth.uid())=user_id);
create policy energy_studio_versions_insert_own on public.energy_studio_versions for insert to authenticated with check ((select auth.uid())=user_id);
create policy energy_studio_versions_update_own on public.energy_studio_versions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy energy_studio_versions_delete_own on public.energy_studio_versions for delete to authenticated using ((select auth.uid())=user_id);

create policy energy_render_jobs_select_own on public.energy_render_jobs for select to authenticated using ((select auth.uid())=user_id);
create policy energy_render_jobs_insert_own on public.energy_render_jobs for insert to authenticated with check ((select auth.uid())=user_id);
create policy energy_render_jobs_update_own on public.energy_render_jobs for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy energy_render_jobs_delete_own on public.energy_render_jobs for delete to authenticated using ((select auth.uid())=user_id);

update storage.buckets
set file_size_limit=52428800,
    allowed_mime_types=array['video/mp4','video/webm','image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/wav','audio/ogg']
where id='energy-media';
