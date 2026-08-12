create or replace function public.energy_sales_priority_v2(p_limit integer default 500)
returns table(
  lead_id uuid,
  company_name text,
  contact_name text,
  phone text,
  email text,
  city text,
  status text,
  total_score integer,
  intent_score integer,
  pv_score integer,
  site_status text,
  estimated_capacity_kwp numeric,
  estimated_annual_generation_kwh numeric,
  pv_yield_kwh_per_kwp numeric,
  open_hot_alerts integer,
  due_hot_followups integer,
  priority_index integer,
  priority_reason text,
  next_action text
)
language sql
security invoker
set search_path=public,pg_catalog
as $$
  with base as (
    select l.*,
      s.status as si_status,s.estimated_capacity_kwp,s.estimated_annual_generation_kwh,s.pv_yield_kwh_per_kwp,s.roof_area_m2 as si_roof,
      coalesce((select count(*) from public.energy_alerts a where a.user_id=l.user_id and a.lead_id=l.id and a.status='open' and a.severity in ('hot','critical')),0)::int as hot_alert_count,
      coalesce((select count(*) from public.energy_followups f where f.user_id=l.user_id and f.lead_id=l.id and f.status='open' and f.priority='hot' and f.due_at<=now()),0)::int as due_hot_count
    from public.energy_leads l
    left join public.energy_site_intelligence s on s.user_id=l.user_id and s.lead_id=l.id
    where l.user_id=(select auth.uid())
      and coalesce(l.do_not_contact,false)=false
      and l.status not in ('won','lost')
      and (
        (coalesce(l.phone,'')<>'' and coalesce(l.metadata->>'phone_status','')<>'invalid')
        or (coalesce(l.email,'')<>'' and coalesce(l.email_status,'unknown')<>'invalid')
      )
  ), scored as (
    select *,
      case
        when estimated_capacity_kwp>=500 then 50
        when estimated_capacity_kwp>=250 then 40
        when estimated_capacity_kwp>=100 then 30
        when estimated_capacity_kwp>=50 then 20
        when si_roof is not null then 12
        when si_status is not null then 6
        else 0
      end as site_bonus,
      case when hot_alert_count>0 then 100 else 0 end as alert_bonus,
      case when due_hot_count>0 then 80 else 0 end as followup_bonus
    from base
  )
  select id,company_name,contact_name,phone,email,city,status,total_score,intent_score,pv_score,
    si_status,estimated_capacity_kwp,estimated_annual_generation_kwh,pv_yield_kwh_per_kwp,hot_alert_count,due_hot_count,
    (coalesce(total_score,0)*2 + coalesce(intent_score,0)*2 + site_bonus + alert_bonus + followup_bonus)::int as priority_index,
    concat_ws(' · ',
      case when hot_alert_count>0 then hot_alert_count||' Hot Alert' || case when hot_alert_count>1 then 's' else '' end end,
      case when due_hot_count>0 then due_hot_count||' fälliges Hot Follow-up' end,
      case when estimated_capacity_kwp>=500 then 'PV-Flächenmodell ≥500 kWp'
           when estimated_capacity_kwp>=250 then 'PV-Flächenmodell ≥250 kWp'
           when estimated_capacity_kwp>=100 then 'PV-Flächenmodell ≥100 kWp'
           when estimated_capacity_kwp>=50 then 'PV-Flächenmodell ≥50 kWp'
           when si_roof is not null then 'Dachfläche analysiert'
           when si_status is not null then 'PVGIS Standort analysiert' end,
      case when intent_score>=70 then 'Intent '||intent_score||'/100' end,
      case when total_score>=75 then 'A-Lead '||total_score||'/100' end
    ) as priority_reason,
    case
      when hot_alert_count>0 or due_hot_count>0 then 'Jetzt persönlich nachfassen.'
      when estimated_capacity_kwp>=100 and phone is not null then 'PV-Potenzial als Call-Opener nutzen.'
      when si_status is null then 'PV-Standortanalyse ergänzen.'
      when phone is not null then 'Anrufen und Dach-/Verbrauchsdaten verifizieren.'
      else 'Personalisierte E-Mail mit Standortbenchmark senden.'
    end as suggested_action
  from scored
  order by 17 desc,coalesce(total_score,0) desc
  limit greatest(1,least(coalesce(p_limit,500),2000));
$$;

revoke all on function public.energy_sales_priority_v2(integer) from public,anon;
grant execute on function public.energy_sales_priority_v2(integer) to authenticated;
