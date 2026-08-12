create table if not exists public.energy_campaign_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.energy_campaigns(id) on delete cascade,
  name text not null,
  weight smallint not null default 50 check (weight between 1 and 100),
  subject_template text not null,
  body_template text not null,
  active boolean not null default true,
  sent_count integer not null default 0,
  replied_count integer not null default 0,
  meeting_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.energy_campaign_variants enable row level security;
drop policy if exists "campaign variants owner" on public.energy_campaign_variants;
create policy "campaign variants owner" on public.energy_campaign_variants for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.energy_campaign_variants to authenticated;
create index if not exists energy_campaign_variants_campaign_idx on public.energy_campaign_variants(campaign_id,active);

alter table public.energy_mailboxes
  add column if not exists ramp_enabled boolean not null default true,
  add column if not exists ramp_started_at timestamptz default now(),
  add column if not exists ramp_start_limit smallint not null default 10,
  add column if not exists ramp_increment_per_day smallint not null default 5,
  add column if not exists ramp_target_limit smallint not null default 30,
  add column if not exists domain_health jsonb not null default '{}'::jsonb,
  add column if not exists domain_health_checked_at timestamptz;

alter table public.energy_campaigns
  add column if not exists ab_testing_enabled boolean not null default false;
