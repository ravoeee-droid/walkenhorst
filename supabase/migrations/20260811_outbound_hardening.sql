-- Applied production hardening after final_outbound_v1.
-- Safe to keep as the reproducible source of the live Walkenhorst backend.

revoke all on function public.energy_track_email_event(uuid,text,text,text) from anon,authenticated;
revoke all on function public.energy_unsubscribe(uuid) from anon,authenticated;
grant execute on function public.energy_track_email_event(uuid,text,text,text) to service_role;
grant execute on function public.energy_unsubscribe(uuid) to service_role;

do $$ begin
  if not exists(select 1 from vault.secrets where name='energy_worker_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'energy_worker_key','Walkenhorst outbound worker authentication');
  end if;
end $$;

alter table public.energy_messages add column if not exists step_order smallint;
create unique index if not exists energy_messages_member_step_unique on public.energy_messages(campaign_member_id,step_order) where campaign_member_id is not null and step_order is not null and direction='outbound';
create unique index if not exists energy_leads_source_external_unique on public.energy_leads(user_id,source,source_external_id) where source_external_id is not null;

create or replace function public.energy_handle_video_intent()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_page public.energy_video_pages%rowtype; v_boost int:=0; v_hot boolean:=false;
begin
  select * into v_page from public.energy_video_pages where id=new.video_page_id;
  if v_page.id is null then return new; end if;
  if new.event_type='play' then v_boost:=5; end if;
  if new.event_type='progress' then
    if coalesce(new.watch_percent,0)>=90 then v_boost:=20; v_hot:=true;
    elsif coalesce(new.watch_percent,0)>=75 then v_boost:=12; v_hot:=true;
    elsif coalesce(new.watch_percent,0)>=50 then v_boost:=7;
    else v_boost:=2; end if;
  end if;
  if new.event_type='cta_click' then v_boost:=25; v_hot:=true; end if;
  if v_boost>0 then
    update public.energy_leads set intent_score=least(100,intent_score+v_boost),status=case when v_hot and status in ('new','research','ready','contacted') then 'engaged' else status end,updated_at=now() where id=v_page.lead_id;
  end if;
  if v_hot and not exists(select 1 from public.energy_followups where lead_id=v_page.lead_id and status='open' and reason like 'Video Intent:%') then
    insert into public.energy_followups(user_id,lead_id,title,due_at,priority,reason) values(v_page.user_id,v_page.lead_id,v_page.company_name||' zeigt starkes Video-Interesse',now(),'hot','Video Intent: '||new.event_type||case when new.watch_percent is not null then ' '||new.watch_percent||'%' else '' end);
    insert into public.energy_activities(user_id,lead_id,activity_type,title,detail) values(v_page.user_id,v_page.lead_id,'video_intent','🔥 Hot Lead durch Video',new.event_type||case when new.watch_percent is not null then ' · '||new.watch_percent||'%' else '' end);
  end if;
  return new;
end; $$;
revoke all on function public.energy_handle_video_intent() from public,anon,authenticated;
drop trigger if exists energy_video_intent_trigger on public.energy_video_events;
create trigger energy_video_intent_trigger after insert on public.energy_video_events for each row execute function public.energy_handle_video_intent();

create index if not exists energy_activities_campaign_idx on public.energy_activities(campaign_id) where campaign_id is not null;
create index if not exists energy_followups_campaign_idx on public.energy_followups(campaign_id) where campaign_id is not null;
create index if not exists energy_followups_lead_idx on public.energy_followups(lead_id);

create or replace function public.energy_normalize_lead_urls()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.website is not null and btrim(new.website)<>'' and new.website !~* '^https?://' then new.website:='https://' || btrim(new.website); end if;
  if new.linkedin_url is not null and btrim(new.linkedin_url)<>'' and new.linkedin_url !~* '^https?://' then new.linkedin_url:='https://' || btrim(new.linkedin_url); end if;
  return new;
end; $$;
revoke all on function public.energy_normalize_lead_urls() from public,anon,authenticated;
drop trigger if exists energy_normalize_lead_urls_trigger on public.energy_leads;
create trigger energy_normalize_lead_urls_trigger before insert or update of website,linkedin_url on public.energy_leads for each row execute function public.energy_normalize_lead_urls();

do $$ declare existing_job bigint; begin
  select jobid into existing_job from cron.job where jobname='walkenhorst-campaign-worker' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'walkenhorst-campaign-worker',
  '* * * * *',
  $$select net.http_post(
    url := 'https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/campaign-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='energy_worker_key')),
    body := jsonb_build_object('source','cron','limit',10)
  );$$
);
