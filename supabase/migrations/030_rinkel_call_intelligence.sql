alter table public.energy_integrations drop constraint if exists energy_integrations_provider_check;
alter table public.energy_integrations add constraint energy_integrations_provider_check check (provider = any (array[
  'google_maps'::text,'firecrawl'::text,'reacher'::text,'chatwoot'::text,'activepieces'::text,'papermark'::text,'dub'::text,'openreplay'::text,'typebot'::text,'twenty'::text,'warmbly'::text,'denshees'::text,'rinkel'::text
]));

create or replace function public.energy_normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when x.digits='' then null
    when x.raw like '+%' then '+'||x.digits
    when x.digits like '00%' then '+'||substr(x.digits,3)
    when x.digits like '0%' then '+49'||substr(x.digits,2)
    else '+'||x.digits
  end
  from (
    select btrim(coalesce(p_phone,'')) as raw,
           regexp_replace(coalesce(p_phone,''),'\D','','g') as digits
  ) x;
$$;

alter table public.energy_leads add column if not exists phone_e164 text;
update public.energy_leads set phone_e164=public.energy_normalize_phone(phone) where phone is not null and phone_e164 is distinct from public.energy_normalize_phone(phone);
create index if not exists energy_leads_user_phone_e164_idx on public.energy_leads(user_id,phone_e164) where phone_e164 is not null;

create or replace function public.energy_sync_phone_e164()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  new.phone_e164:=public.energy_normalize_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists energy_leads_phone_e164_trg on public.energy_leads;
create trigger energy_leads_phone_e164_trg before insert or update of phone on public.energy_leads for each row execute function public.energy_sync_phone_e164();

create table if not exists public.energy_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete set null,
  provider text not null default 'rinkel' check (provider in ('rinkel','manual')),
  external_call_id text not null,
  direction text not null default 'unknown' check (direction in ('incoming','outgoing','unknown')),
  from_phone text,
  to_phone text,
  rinkel_user_id text,
  answered_by text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  cause text,
  recording_url text,
  sentiment text,
  topics text[] not null default '{}',
  ai_summary text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,provider,external_call_id)
);
create index if not exists energy_calls_user_updated_idx on public.energy_calls(user_id,updated_at desc);
create index if not exists energy_calls_lead_idx on public.energy_calls(lead_id,updated_at desc);

alter table public.energy_calls enable row level security;
drop policy if exists "call owner access" on public.energy_calls;
create policy "call owner access" on public.energy_calls for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create table if not exists public.energy_call_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  call_id uuid references public.energy_calls(id) on delete cascade,
  provider text not null default 'rinkel',
  external_call_id text not null,
  event_type text not null check (event_type in ('incoming','outgoing','start','end','insights','unknown')),
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id,provider,external_call_id,event_type)
);
create index if not exists energy_call_events_user_created_idx on public.energy_call_events(user_id,created_at desc);
create index if not exists energy_call_events_call_idx on public.energy_call_events(call_id,created_at desc);

alter table public.energy_call_events enable row level security;
drop policy if exists "call event owner access" on public.energy_call_events;
create policy "call event owner access" on public.energy_call_events for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
