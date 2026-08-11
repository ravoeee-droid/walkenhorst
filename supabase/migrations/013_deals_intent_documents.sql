create table if not exists public.energy_deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  title text not null,
  stage text not null default 'qualified' check (stage in ('new','qualified','meeting','proposal','negotiation','won','lost')),
  value_eur numeric(12,2),
  probability smallint not null default 20 check (probability between 0 and 100),
  expected_close_date date,
  notes text,
  lost_reason text,
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, lead_id)
);

create table if not exists public.energy_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  deal_id uuid references public.energy_deals(id) on delete set null,
  provider text not null default 'manual',
  external_document_id text,
  external_link_id text,
  title text not null,
  share_url text,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','expired','archived')),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  total_view_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_intent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  source text not null,
  event_type text not null,
  weight smallint not null default 0 check (weight between -100 and 100),
  external_id text,
  session_id text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists energy_intent_events_dedupe_idx
  on public.energy_intent_events(user_id, source, external_id)
  where external_id is not null;
create index if not exists energy_intent_events_lead_time_idx on public.energy_intent_events(lead_id, occurred_at desc);
create index if not exists energy_deals_user_stage_idx on public.energy_deals(user_id, stage, updated_at desc);
create index if not exists energy_documents_lead_idx on public.energy_documents(lead_id, updated_at desc);

alter table public.energy_deals enable row level security;
alter table public.energy_documents enable row level security;
alter table public.energy_intent_events enable row level security;

drop policy if exists "deals owner" on public.energy_deals;
create policy "deals owner" on public.energy_deals for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "documents owner" on public.energy_documents;
create policy "documents owner" on public.energy_documents for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "intent owner" on public.energy_intent_events;
create policy "intent owner" on public.energy_intent_events for select to authenticated using ((select auth.uid())=user_id);

grant select,insert,update,delete on public.energy_deals to authenticated;
grant select,insert,update,delete on public.energy_documents to authenticated;
grant select on public.energy_intent_events to authenticated;

create or replace function public.energy_process_intent_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text;
  v_old_score integer;
  v_new_score integer;
  v_new_status text;
begin
  select company_name, intent_score, status
    into v_company, v_old_score, v_new_status
  from public.energy_leads
  where id = new.lead_id and user_id = new.user_id;

  if not found then return new; end if;

  v_new_score := greatest(0, least(100, coalesce(v_old_score,0) + new.weight));
  if new.weight >= 20 and v_new_status in ('new','research','ready','contacted') then
    v_new_status := 'engaged';
  end if;

  update public.energy_leads
  set intent_score=v_new_score,
      status=v_new_status,
      updated_at=now()
  where id=new.lead_id and user_id=new.user_id;

  insert into public.energy_activities(user_id,lead_id,activity_type,title,detail,metadata)
  values(new.user_id,new.lead_id,'intent_event',concat('Intent: ',new.event_type),concat(new.source,' · +',new.weight),jsonb_build_object('intent_event_id',new.id,'source',new.source,'score_after',v_new_score));

  if new.weight >= 25 then
    insert into public.energy_followups(user_id,lead_id,title,due_at,priority,reason)
    select new.user_id,new.lead_id,concat(v_company,' zeigt starkes Kaufsignal'),now(),case when new.weight>=35 then 'hot' else 'high' end,concat(new.source,' · ',new.event_type)
    where not exists (
      select 1 from public.energy_followups f
      where f.user_id=new.user_id and f.lead_id=new.lead_id and f.status='open' and f.created_at > now()-interval '12 hours'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists energy_intent_event_trigger on public.energy_intent_events;
create trigger energy_intent_event_trigger
after insert on public.energy_intent_events
for each row execute function public.energy_process_intent_event();
