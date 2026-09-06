alter table public.energy_leads add column if not exists email_verification_status text not null default 'unchecked';
alter table public.energy_leads add column if not exists email_verification_reason text;
alter table public.energy_leads add column if not exists email_verified_at timestamptz;
alter table public.energy_leads add column if not exists email_verification_meta jsonb not null default '{}'::jsonb;

update public.energy_leads
set email_verification_status='invalid',
    email_verification_reason=coalesce(email_verification_reason,'existing_invalid_status'),
    email_verified_at=coalesce(email_verified_at, now())
where email_status='invalid' and email_verification_status<>'invalid';

create index if not exists idx_energy_leads_email_verification_queue
on public.energy_leads (email_verification_status, created_at desc)
where email is not null and email <> '' and email_status <> 'invalid';

create or replace function public.energy_campaign_member_audience_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_type text;
  actual_type text;
begin
  select nullif(c.lead_filter->>'customerType','')
    into target_type
  from public.energy_campaigns c
  where c.id = new.campaign_id;

  if target_type is not null then
    select l.customer_type into actual_type
    from public.energy_leads l
    where l.id = new.lead_id;

    if actual_type is distinct from target_type then
      raise exception 'campaign audience mismatch: expected %, got %', target_type, coalesce(actual_type,'null');
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.energy_campaign_member_audience_guard() from public, anon, authenticated;

drop trigger if exists trg_energy_campaign_member_audience_guard on public.energy_campaign_members;
create trigger trg_energy_campaign_member_audience_guard
before insert or update of campaign_id, lead_id on public.energy_campaign_members
for each row execute function public.energy_campaign_member_audience_guard();
