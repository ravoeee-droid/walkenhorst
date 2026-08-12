create table if not exists public.energy_site_intelligence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  provider text not null default 'pvgis',
  latitude double precision not null,
  longitude double precision not null,
  geo_source text not null default 'geocoded',
  geo_label text,
  roof_area_m2 numeric,
  pv_yield_kwh_per_kwp numeric,
  irradiation_kwh_m2 numeric,
  optimal_slope_deg numeric,
  optimal_azimuth_deg numeric,
  estimated_capacity_kwp numeric,
  estimated_annual_generation_kwh numeric,
  assumptions jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('ready','partial','error')),
  error text,
  analyzed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,lead_id)
);

create index if not exists energy_site_intelligence_user_idx on public.energy_site_intelligence(user_id,analyzed_at desc);
create index if not exists energy_site_intelligence_lead_idx on public.energy_site_intelligence(lead_id);
alter table public.energy_site_intelligence enable row level security;
drop policy if exists "site intelligence owner access" on public.energy_site_intelligence;
create policy "site intelligence owner access" on public.energy_site_intelligence
for all to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);
