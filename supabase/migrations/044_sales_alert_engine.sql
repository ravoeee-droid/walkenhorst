create table if not exists public.energy_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  alert_type text not null,
  severity text not null default 'warn' check (severity in ('info','warn','hot','critical')),
  title text not null,
  detail text,
  dedupe_key text not null,
  status text not null default 'open' check (status in ('open','acknowledged','done')),
  due_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,dedupe_key)
);

create index if not exists energy_alerts_user_status_due_idx on public.energy_alerts(user_id,status,severity,due_at);
create index if not exists energy_alerts_lead_idx on public.energy_alerts(lead_id,created_at desc) where lead_id is not null;
alter table public.energy_alerts enable row level security;
drop policy if exists "alert owner access" on public.energy_alerts;
create policy "alert owner access" on public.energy_alerts for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create or replace function public.energy_upsert_alert(
  p_user_id uuid,p_lead_id uuid,p_type text,p_severity text,p_title text,p_detail text,p_key text,p_due_at timestamptz,p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare v_id uuid;
begin
  insert into public.energy_alerts(user_id,lead_id,alert_type,severity,title,detail,dedupe_key,status,due_at,metadata)
  values(p_user_id,p_lead_id,p_type,p_severity,p_title,left(p_detail,2000),p_key,'open',p_due_at,coalesce(p_metadata,'{}'::jsonb))
  on conflict(user_id,dedupe_key) do update set
    lead_id=excluded.lead_id,alert_type=excluded.alert_type,severity=excluded.severity,title=excluded.title,detail=excluded.detail,
    status=case when energy_alerts.status='done' then 'open' else energy_alerts.status end,
    due_at=excluded.due_at,metadata=energy_alerts.metadata||excluded.metadata,updated_at=now(),resolved_at=case when energy_alerts.status='done' then null else energy_alerts.resolved_at end
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.energy_intent_to_alert()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare l_name text;v_severity text;v_due timestamptz;
begin
  if coalesce(new.weight,0)<25 and new.event_type<>'positive_call_sentiment' then return new; end if;
  select company_name into l_name from public.energy_leads where id=new.lead_id;
  v_severity:=case when new.weight>=35 then 'critical' when new.weight>=25 then 'hot' else 'warn' end;
  v_due:=now()+case when v_severity='critical' then interval '10 minutes' when v_severity='hot' then interval '15 minutes' else interval '30 minutes' end;
  perform public.energy_upsert_alert(new.user_id,new.lead_id,'intent_signal',v_severity,
    coalesce(l_name,'Lead')||': starkes Kaufsignal',
    new.event_type||' · +'||new.weight||' Intent · Quelle '||new.source,
    'intent:'||new.id::text,v_due,
    jsonb_build_object('intent_event_id',new.id,'event_type',new.event_type,'source',new.source,'weight',new.weight));
  return new;
end;
$$;

drop trigger if exists energy_intent_alert_trg on public.energy_intent_events;
create trigger energy_intent_alert_trg after insert on public.energy_intent_events for each row execute function public.energy_intent_to_alert();

create or replace function public.energy_alert_action(p_alert_id uuid,p_action text)
returns boolean
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
begin
  if p_action='acknowledge' then
    update public.energy_alerts set status='acknowledged',acknowledged_at=now(),updated_at=now() where id=p_alert_id and user_id=(select auth.uid());
  elsif p_action='done' then
    update public.energy_alerts set status='done',resolved_at=now(),updated_at=now() where id=p_alert_id and user_id=(select auth.uid());
  elsif p_action='reopen' then
    update public.energy_alerts set status='open',resolved_at=null,acknowledged_at=null,updated_at=now() where id=p_alert_id and user_id=(select auth.uid());
  else
    raise exception 'invalid alert action';
  end if;
  return found;
end;
$$;

revoke all on function public.energy_alert_action(uuid,text) from public,anon;
grant execute on function public.energy_alert_action(uuid,text) to authenticated;
