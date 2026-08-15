alter table public.energy_campaigns
  add column if not exists send_interval_minutes smallint not null default 5,
  add column if not exists mailbox_ids uuid[] not null default '{}'::uuid[],
  add column if not exists next_send_at timestamptz,
  add column if not exists last_send_at timestamptz;

do $$ begin
  alter table public.energy_campaigns add constraint energy_campaigns_send_interval_minutes_check check (send_interval_minutes between 1 and 1440);
exception when duplicate_object then null; end $$;

create index if not exists energy_campaigns_active_next_send_idx
  on public.energy_campaigns(status,next_send_at)
  where status='active';

create or replace function public.energy_claim_campaign_send_slot(
  p_campaign_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  claimed boolean := false;
begin
  update public.energy_campaigns
     set next_send_at = p_now + make_interval(mins => greatest(1, send_interval_minutes::int)),
         last_send_at = p_now,
         updated_at = p_now
   where id = p_campaign_id
     and status = 'active'
     and (next_send_at is null or next_send_at <= p_now)
  returning true into claimed;
  return coalesce(claimed,false);
end;
$$;

revoke all on function public.energy_claim_campaign_send_slot(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.energy_claim_campaign_send_slot(uuid,timestamptz) to service_role;
