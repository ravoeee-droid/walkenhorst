alter table public.energy_leads add column if not exists marketing_consent_at timestamptz;
alter table public.energy_leads add column if not exists consent_source text;
alter table public.energy_leads add column if not exists consent_metadata jsonb not null default '{}'::jsonb;

create or replace function public.energy_campaign_member_audience_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_type text;
  actual_type text;
  consent_at timestamptz;
begin
  select nullif(c.lead_filter->>'customerType','')
    into target_type
  from public.energy_campaigns c
  where c.id = new.campaign_id;

  if target_type is not null then
    select l.customer_type, l.marketing_consent_at
      into actual_type, consent_at
    from public.energy_leads l
    where l.id = new.lead_id;

    if actual_type is distinct from target_type then
      raise exception 'campaign audience mismatch: expected %, got %', target_type, coalesce(actual_type,'null');
    end if;

    if target_type = 'private' and consent_at is null then
      raise exception 'private outbound requires explicit marketing consent';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.energy_campaign_member_audience_guard() from public, anon, authenticated;
