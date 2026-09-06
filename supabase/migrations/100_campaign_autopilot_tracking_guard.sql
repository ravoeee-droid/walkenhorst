-- Final Walkenhorst outbound autopilot hardening.
-- 1) Keep a prepared step-1 buffer, 2) only count recipient-attributed video events,
-- 3) warn before the commercial lead pool runs dry.

create or replace function public.energy_validate_video_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_lead uuid;
  v_page_lead uuid;
begin
  if new.message_tracking_token is null then return null; end if;

  select m.lead_id into v_message_lead
  from public.energy_messages m
  where m.tracking_token = new.message_tracking_token
    and m.direction='outbound'
    and m.status in ('sent','delivered','opened','clicked','replied')
  limit 1;

  select p.lead_id into v_page_lead
  from public.energy_video_pages p
  where p.id = new.video_page_id
  limit 1;

  if v_message_lead is null or v_page_lead is null or v_message_lead <> v_page_lead then
    return null;
  end if;

  if new.event_type='session_view' then new.event_type:='view';
  elsif new.event_type in ('playback_start','playback_resume') then new.event_type:='play';
  elsif new.event_type in ('playback_watch','playback_pause','playback_complete','playback_seek') then new.event_type:='progress';
  elsif new.event_type='cta_attributed' then new.event_type:='cta_click';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_energy_video_attribution_guard on public.energy_video_events;
create trigger trg_energy_video_attribution_guard
before insert on public.energy_video_events
for each row execute function public.energy_validate_video_attribution();

-- Historical events without a campaign-message token are preview/test traffic, not sales evidence.
update public.energy_leads l
set
  status = case when exists(
    select 1 from public.energy_messages m
    where m.lead_id=l.id and m.direction='outbound'
      and m.status in ('sent','delivered','opened','clicked','replied')
  ) then 'contacted' else 'research' end,
  intent_score = least(100,
    36
    + case when nullif(btrim(coalesce(l.website,'')),'') is not null then 8 else 0 end
    + case when l.pv_present is false then 10 else 0 end
    + case when coalesce(l.roof_area_m2,0)>=800 then 12 else 0 end
    + case when coalesce(l.industry,'') ~* '(produktion|industrie|logistik|lager|hotel|gastronomie|pflege|autohaus|werkstatt|landwirtschaft|lebensmittel|kühl|metall|kunststoff|druck|rechenzentrum|fitness)' then 12 else 0 end
    + case when coalesce(l.location_count,1)>=2 then 8 else 0 end
  ),
  next_action = case
    when exists(select 1 from public.energy_email_events ee join public.energy_messages m on m.id=ee.message_id where m.lead_id=l.id and ee.event_type='open')
      and exists(select 1 from public.energy_messages m where m.lead_id=l.id and m.direction='outbound' and m.status in ('sent','delivered','opened','clicked','replied'))
      then 'E-Mail geöffnet – bei erneutem Signal priorisieren'
    when exists(select 1 from public.energy_messages m where m.lead_id=l.id and m.direction='outbound' and m.status in ('sent','delivered','opened','clicked','replied'))
      then 'E-Mail gesendet – Reaktion beobachten'
    when coalesce(l.total_score,0)>=80 then 'Heute priorisiert anrufen und personalisierte Video-Analyse senden.'
    when coalesce(l.total_score,0)>=65 then 'Research vervollständigen, Video-Seite erstellen und innerhalb von 24 Stunden kontaktieren.'
    else 'Daten anreichern und vor aktivem Outreach erneut bewerten.' end,
  next_action_at = case when exists(select 1 from public.energy_messages m where m.lead_id=l.id and m.direction='outbound' and m.status in ('sent','delivered','opened','clicked','replied')) then now()+interval '1 day' else null end,
  updated_at=now()
where l.id in (
  select distinct p.lead_id from public.energy_video_events ve
  join public.energy_video_pages p on p.id=ve.video_page_id
  where ve.message_tracking_token is null
)
and l.status in ('engaged','qualified')
and not exists(select 1 from public.energy_messages m where m.lead_id=l.id and (m.direction='inbound' or m.replied_at is not null))
and not exists(select 1 from public.energy_email_events ee join public.energy_messages m on m.id=ee.message_id where m.lead_id=l.id and ee.event_type='click');

update public.energy_followups set status='done',completed_at=coalesce(completed_at,now())
where status='open' and coalesce(reason,'') ilike 'video ·%';
update public.energy_alerts set status='done',resolved_at=coalesce(resolved_at,now()),updated_at=now()
where status='open' and ((alert_type='intent_signal' and coalesce(detail,'') ilike '%Quelle video%') or (alert_type='hot_followup_overdue' and coalesce(detail,'') ilike 'video ·%'));
delete from public.energy_intent_events where source='video';
delete from public.energy_video_events where message_tracking_token is null;

create or replace function public.energy_check_lead_pool_health()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c record; v_available integer; v_key text;
begin
  for c in select id,user_id,name from public.energy_campaigns where status='active' and coalesce(lead_filter->>'customerType','commercial')='commercial' loop
    select count(*)::int into v_available
    from public.energy_leads l
    where l.user_id=c.user_id and l.customer_type='commercial'
      and l.status in ('new','research','ready') and l.do_not_contact=false and l.unsubscribed_at is null
      and l.email is not null and l.email<>'' and l.email_status<>'invalid'
      and l.website is not null and l.website<>''
      and not exists(select 1 from public.energy_messages m where m.lead_id=l.id and m.direction='outbound');
    v_key:='lead-pool:'||c.id::text;
    if v_available<150 then
      perform public.energy_upsert_alert(c.user_id,null,'lead_pool_low','warn','B2B-Lead-Pool wird knapp',format('%s versandfähige, noch nicht kontaktierte B2B-Leads verfügbar. Neue Leads nachfüllen.',v_available),v_key,null,jsonb_build_object('campaign_id',c.id,'available',v_available,'threshold',150));
    else
      update public.energy_alerts set status='done',resolved_at=coalesce(resolved_at,now()),updated_at=now()
      where user_id=c.user_id and alert_type='lead_pool_low' and status='open' and dedupe_key=v_key;
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'walkenhorst-campaign-prep','*/10 * * * *',
  $$select net.http_post(
    url := 'https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/campaign-prep-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='energy_worker_key' limit 1)),
    body := jsonb_build_object('limit',1),timeout_milliseconds := 55000
  );$$
);
select cron.schedule('walkenhorst-lead-pool-health','15 */6 * * *',$$select public.energy_check_lead_pool_health();$$);
select public.energy_check_lead_pool_health();
