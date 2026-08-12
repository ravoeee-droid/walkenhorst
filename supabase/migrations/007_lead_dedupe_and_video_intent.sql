create unique index if not exists energy_leads_source_external_unique on public.energy_leads(user_id,source,source_external_id) where source_external_id is not null;

create or replace function public.energy_handle_video_intent()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_page public.energy_video_pages%rowtype;
  v_boost int:=0;
  v_hot boolean:=false;
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
    insert into public.energy_followups(user_id,lead_id,title,due_at,priority,reason)
    values(v_page.user_id,v_page.lead_id,v_page.company_name||' zeigt starkes Video-Interesse',now(),'hot','Video Intent: '||new.event_type||case when new.watch_percent is not null then ' '||new.watch_percent||'%' else '' end);
    insert into public.energy_activities(user_id,lead_id,activity_type,title,detail)
    values(v_page.user_id,v_page.lead_id,'video_intent','🔥 Hot Lead durch Video',new.event_type||case when new.watch_percent is not null then ' · '||new.watch_percent||'%' else '' end);
  end if;
  return new;
end;
$$;
revoke all on function public.energy_handle_video_intent() from public,anon,authenticated;

drop trigger if exists energy_video_intent_trigger on public.energy_video_events;
create trigger energy_video_intent_trigger after insert on public.energy_video_events for each row execute function public.energy_handle_video_intent();
