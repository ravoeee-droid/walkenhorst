create extension if not exists pgcrypto;

create table if not exists public.energy_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  website text,
  city text,
  industry text,
  employees integer,
  location_count integer not null default 1,
  roof_area_m2 numeric,
  annual_energy_kwh numeric,
  pv_present boolean,
  contact_name text,
  phone text,
  email text,
  pv_score smallint not null default 0 check (pv_score between 0 and 100),
  energy_score smallint not null default 0 check (energy_score between 0 and 100),
  intent_score smallint not null default 0 check (intent_score between 0 and 100),
  contactability_score smallint not null default 0 check (contactability_score between 0 and 100),
  total_score smallint not null default 0 check (total_score between 0 and 100),
  summary text,
  pitch text,
  next_action text,
  status text not null default 'new' check (status in ('new','research','ready','contacted','engaged','qualified','meeting','proposal','won','lost','nurture')),
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_video_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  slug text not null unique,
  company_name text not null,
  prospect_name text,
  website_url text,
  presenter_video_url text,
  headline text not null,
  intro_text text,
  bullets jsonb not null default '[]'::jsonb,
  cta_label text not null default 'Kostenlosen Potenzialcheck vereinbaren',
  cta_url text,
  duration_seconds integer not null default 97,
  status text not null default 'ready' check (status in ('draft','ready','sent','archived')),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_video_events (
  id bigint generated always as identity primary key,
  video_page_id uuid not null references public.energy_video_pages(id) on delete cascade,
  event_type text not null check (event_type in ('view','play','progress','cta_click')),
  watch_percent smallint check (watch_percent between 0 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.energy_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_address text not null,
  from_name text,
  provider text not null default 'smtp',
  daily_limit smallint not null default 30 check (daily_limit between 1 and 50),
  status text not null default 'setup' check (status in ('setup','warming','ready','paused','error')),
  created_at timestamptz not null default now(),
  unique(user_id,email_address)
);

create table if not exists public.energy_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','completed')),
  subject_template text,
  body_template text,
  daily_limit smallint not null default 30 check (daily_limit between 1 and 150),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.energy_campaigns(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  video_page_id uuid references public.energy_video_pages(id) on delete set null,
  status text not null default 'queued',
  last_step_at timestamptz,
  created_at timestamptz not null default now(),
  unique(campaign_id,lead_id)
);

create index if not exists energy_leads_user_score_idx on public.energy_leads(user_id,total_score desc);
create index if not exists energy_leads_user_status_idx on public.energy_leads(user_id,status);
create index if not exists energy_video_pages_user_idx on public.energy_video_pages(user_id,created_at desc);
create index if not exists energy_video_pages_lead_idx on public.energy_video_pages(lead_id);
create index if not exists energy_video_events_page_idx on public.energy_video_events(video_page_id,created_at desc);
create index if not exists energy_campaigns_user_idx on public.energy_campaigns(user_id,created_at desc);
create index if not exists energy_campaign_members_campaign_idx on public.energy_campaign_members(campaign_id,status);

alter table public.energy_leads enable row level security;
alter table public.energy_video_pages enable row level security;
alter table public.energy_video_events enable row level security;
alter table public.energy_mailboxes enable row level security;
alter table public.energy_campaigns enable row level security;
alter table public.energy_campaign_members enable row level security;

create policy "lead owner full access" on public.energy_leads for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "video owner full access" on public.energy_video_pages for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "public can read active videos" on public.energy_video_pages for select to anon using (is_public = true and status in ('ready','sent'));
create policy "video owner reads events" on public.energy_video_events for select to authenticated using (exists (select 1 from public.energy_video_pages p where p.id = video_page_id and p.user_id = (select auth.uid())));
create policy "public can insert video events" on public.energy_video_events for insert to anon with check (exists (select 1 from public.energy_video_pages p where p.id = video_page_id and p.is_public = true and p.status in ('ready','sent')));
create policy "authenticated can insert own video events" on public.energy_video_events for insert to authenticated with check (exists (select 1 from public.energy_video_pages p where p.id = video_page_id and p.user_id = (select auth.uid())));
create policy "mailbox owner full access" on public.energy_mailboxes for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "campaign owner full access" on public.energy_campaigns for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "campaign members owner full access" on public.energy_campaign_members for all to authenticated using (exists (select 1 from public.energy_campaigns c where c.id = campaign_id and c.user_id = (select auth.uid()))) with check (exists (select 1 from public.energy_campaigns c where c.id = campaign_id and c.user_id = (select auth.uid())));

grant select,insert,update,delete on public.energy_leads to authenticated;
grant select,insert,update,delete on public.energy_video_pages to authenticated;
grant select on public.energy_video_pages to anon;
grant select,insert on public.energy_video_events to authenticated;
grant insert on public.energy_video_events to anon;
grant usage,select on sequence public.energy_video_events_id_seq to anon,authenticated;
grant select,insert,update,delete on public.energy_mailboxes to authenticated;
grant select,insert,update,delete on public.energy_campaigns to authenticated;
grant select,insert,update,delete on public.energy_campaign_members to authenticated;
