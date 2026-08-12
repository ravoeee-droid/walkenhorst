create table if not exists public.energy_deal_stage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id uuid not null references public.energy_deals(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  value_eur numeric,
  probability smallint,
  created_at timestamptz not null default now()
);

create index if not exists energy_deal_stage_events_user_created_idx on public.energy_deal_stage_events(user_id,created_at desc);
create index if not exists energy_deal_stage_events_deal_idx on public.energy_deal_stage_events(deal_id,created_at desc);
create index if not exists energy_deal_stage_events_lead_idx on public.energy_deal_stage_events(lead_id,created_at desc);

alter table public.energy_deal_stage_events enable row level security;
drop policy if exists "deal stage events owner access" on public.energy_deal_stage_events;
create policy "deal stage events owner access" on public.energy_deal_stage_events
for all to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

create or replace function public.energy_capture_deal_stage_event()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.energy_deal_stage_events(user_id,deal_id,lead_id,from_stage,to_stage,value_eur,probability,created_at)
    values(new.user_id,new.id,new.lead_id,null,new.stage,new.value_eur,new.probability,coalesce(new.created_at,now()));
    return new;
  end if;

  if old.stage is distinct from new.stage then
    insert into public.energy_deal_stage_events(user_id,deal_id,lead_id,from_stage,to_stage,value_eur,probability)
    values(new.user_id,new.id,new.lead_id,old.stage,new.stage,new.value_eur,new.probability);
  end if;
  return new;
end;
$$;

drop trigger if exists energy_deal_stage_history_trg on public.energy_deals;
create trigger energy_deal_stage_history_trg
after insert or update of stage on public.energy_deals
for each row execute function public.energy_capture_deal_stage_event();

insert into public.energy_deal_stage_events(user_id,deal_id,lead_id,from_stage,to_stage,value_eur,probability,created_at)
select d.user_id,d.id,d.lead_id,null,d.stage,d.value_eur,d.probability,d.created_at
from public.energy_deals d
where not exists(select 1 from public.energy_deal_stage_events e where e.deal_id=d.id);
