create table if not exists public.energy_lead_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  kind text not null check (kind in ('special','scrape','manual')),
  industry text,
  source text,
  scraped_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.energy_lead_batches enable row level security;

drop policy if exists "energy_lead_batches_select_own" on public.energy_lead_batches;
create policy "energy_lead_batches_select_own"
on public.energy_lead_batches for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "energy_lead_batches_insert_own" on public.energy_lead_batches;
create policy "energy_lead_batches_insert_own"
on public.energy_lead_batches for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "energy_lead_batches_update_own" on public.energy_lead_batches;
create policy "energy_lead_batches_update_own"
on public.energy_lead_batches for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "energy_lead_batches_delete_own" on public.energy_lead_batches;
create policy "energy_lead_batches_delete_own"
on public.energy_lead_batches for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.energy_lead_batches to authenticated;

alter table public.energy_leads
  add column if not exists batch_id uuid references public.energy_lead_batches(id) on delete set null;

create index if not exists idx_energy_leads_batch_id on public.energy_leads(batch_id);
create index if not exists idx_energy_lead_batches_user_kind_industry on public.energy_lead_batches(user_id, kind, industry, created_at desc);

insert into public.energy_lead_batches (user_id, name, kind, industry, source, scraped_at, metadata)
select distinct l.user_id,
       'Sonderliste · Bestand 14.08.2026',
       'special',
       null,
       'triveo',
       timestamptz '2026-08-14 08:57:20+00',
       jsonb_build_object('locked_special_inventory', true)
from public.energy_leads l
where l.source = 'triveo'
  and not exists (
    select 1 from public.energy_lead_batches b
    where b.user_id = l.user_id and b.kind = 'special' and b.source = 'triveo'
  );

update public.energy_leads l
set batch_id = b.id
from public.energy_lead_batches b
where l.source = 'triveo'
  and l.batch_id is null
  and b.user_id = l.user_id
  and b.kind = 'special'
  and b.source = 'triveo';

insert into public.energy_lead_batches (user_id, name, kind, industry, source, scraped_at, metadata)
select x.user_id,
       coalesce(nullif(x.industry,''), 'Ohne Branche') || ' · ' || to_char(x.scrape_day, 'DD.MM.YYYY') || ' · ' || x.cnt || ' Leads',
       'scrape',
       nullif(x.industry,''),
       x.source,
       x.scrape_day,
       jsonb_build_object('backfilled', true, 'lead_count_at_creation', x.cnt)
from (
  select user_id,
         coalesce(industry,'') as industry,
         source,
         date_trunc('day', min(created_at)) as scrape_day,
         count(*)::text as cnt
  from public.energy_leads
  where source <> 'triveo'
    and source <> 'manual'
    and batch_id is null
  group by user_id, coalesce(industry,''), source, created_at::date
) x
where not exists (
  select 1 from public.energy_lead_batches b
  where b.user_id = x.user_id
    and b.kind = 'scrape'
    and coalesce(b.industry,'') = x.industry
    and coalesce(b.source,'') = coalesce(x.source,'')
    and b.scraped_at::date = x.scrape_day::date
);

update public.energy_leads l
set batch_id = b.id
from public.energy_lead_batches b
where l.batch_id is null
  and l.source <> 'triveo'
  and l.source <> 'manual'
  and b.user_id = l.user_id
  and b.kind = 'scrape'
  and coalesce(b.industry,'') = coalesce(l.industry,'')
  and coalesce(b.source,'') = coalesce(l.source,'')
  and b.scraped_at::date = l.created_at::date;
