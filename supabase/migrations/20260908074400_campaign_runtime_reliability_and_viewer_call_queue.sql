create or replace function public.energy_audit_campaign_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if old.status is distinct from new.status then
    v_reason := coalesce(new.lead_filter->>'master_pause_reason', new.lead_filter->>'pause_reason', 'status_changed');
    insert into public.energy_activities(user_id,campaign_id,activity_type,title,detail,metadata)
    values(
      new.user_id,
      new.id,
      'campaign_status_change',
      format('Kampagne: %s → %s', old.status, new.status),
      v_reason,
      jsonb_build_object(
        'campaign_id', new.id,
        'campaign_name', new.name,
        'from_status', old.status,
        'to_status', new.status,
        'reason', v_reason,
        'daily_limit', new.daily_limit,
        'send_interval_minutes', new.send_interval_minutes,
        'send_window_start', new.send_window_start,
        'send_window_end', new.send_window_end,
        'timezone', new.timezone
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_energy_campaign_status_audit on public.energy_campaigns;
create trigger trg_energy_campaign_status_audit
after update of status on public.energy_campaigns
for each row execute function public.energy_audit_campaign_status_change();

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
  v_campaign_id uuid;
  v_followup_id uuid;
  v_is_video_signal boolean := false;
  v_priority text := 'high';
  v_reason text;
begin
  select company_name, intent_score, status
    into v_company, v_old_score, v_new_status
  from public.energy_leads
  where id = new.lead_id and user_id = new.user_id;

  if not found then return new; end if;

  select m.campaign_id into v_campaign_id
  from public.energy_messages m
  where m.lead_id = new.lead_id
    and m.direction = 'outbound'
    and m.campaign_id is not null
  order by m.sent_at desc nulls last, m.created_at desc
  limit 1;

  v_new_score := greatest(0, least(100, coalesce(v_old_score,0) + new.weight));
  if new.weight >= 20 and v_new_status in ('new','research','ready','contacted') then
    v_new_status := 'engaged';
  end if;

  update public.energy_leads
  set intent_score=v_new_score,
      status=v_new_status,
      updated_at=now()
  where id=new.lead_id and user_id=new.user_id;

  insert into public.energy_activities(user_id,lead_id,campaign_id,activity_type,title,detail,metadata)
  values(
    new.user_id,
    new.lead_id,
    v_campaign_id,
    'intent_event',
    concat('Intent: ',new.event_type),
    concat(new.source,' · +',new.weight),
    jsonb_build_object('intent_event_id',new.id,'source',new.source,'score_after',v_new_score,'campaign_id',v_campaign_id)
  );

  v_is_video_signal := new.source='video' and new.event_type in (
    'video_play','video_25','video_50','video_75','video_90','video_100','video_cta_click'
  );

  if v_is_video_signal then
    v_priority := case when new.event_type in ('video_75','video_90','video_100','video_cta_click') then 'hot' else 'high' end;
    v_reason := case new.event_type
      when 'video_play' then 'Video gestartet – jetzt persönlich nachfassen'
      when 'video_25' then 'Mindestens 25 % des Videos angesehen'
      when 'video_50' then 'Mindestens 50 % des Videos angesehen'
      when 'video_75' then 'Mindestens 75 % des Videos angesehen – heißer Lead'
      when 'video_90' then 'Mindestens 90 % des Videos angesehen – heißer Lead'
      when 'video_100' then 'Video vollständig angesehen – heißer Lead'
      when 'video_cta_click' then 'CTA nach Video geklickt – sofort anrufen'
      else concat(new.source,' · ',new.event_type)
    end;
  elsif new.weight >= 25 then
    v_priority := case when new.weight>=35 then 'hot' else 'high' end;
    v_reason := concat(new.source,' · ',new.event_type);
  else
    return new;
  end if;

  select f.id into v_followup_id
  from public.energy_followups f
  where f.user_id=new.user_id
    and f.lead_id=new.lead_id
    and f.status='open'
    and f.created_at > now()-interval '12 hours'
  order by f.created_at desc
  limit 1;

  if v_followup_id is null then
    insert into public.energy_followups(user_id,lead_id,campaign_id,title,due_at,priority,reason)
    values(
      new.user_id,
      new.lead_id,
      v_campaign_id,
      case when v_is_video_signal then concat(v_company,' hat das Video angesehen') else concat(v_company,' zeigt starkes Kaufsignal') end,
      now(),
      v_priority,
      v_reason
    );
  else
    update public.energy_followups
    set campaign_id=coalesce(campaign_id,v_campaign_id),
        title=case when v_is_video_signal then concat(v_company,' hat das Video angesehen') else title end,
        due_at=least(due_at,now()),
        priority=case when priority='hot' or v_priority='hot' then 'hot' else 'high' end,
        reason=v_reason
    where id=v_followup_id;
  end if;

  return new;
end;
$$;
