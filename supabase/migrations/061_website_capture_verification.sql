alter table public.energy_video_pages
  add column if not exists website_capture_status text not null default 'pending',
  add column if not exists website_capture_verified_at timestamptz,
  add column if not exists website_capture_width integer,
  add column if not exists website_capture_height integer,
  add column if not exists website_capture_error text;

create index if not exists energy_video_pages_capture_status_idx
  on public.energy_video_pages (template_key, website_capture_status, studio_revision);

update public.energy_video_pages
set website_capture_status='pending',
    website_capture_verified_at=null,
    website_capture_width=null,
    website_capture_height=null,
    website_capture_error=null
where template_key='energiekosten';
