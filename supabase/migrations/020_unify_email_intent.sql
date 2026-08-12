create or replace function public.energy_track_email_event(
  p_token uuid,
  p_event text,
  p_url text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.energy_messages%rowtype;
  v_external text;
  v_weight integer;
begin
  if p_event not in ('open','click') then return false; end if;
  select * into v_message from public.energy_messages where tracking_token=p_token limit 1;
  if v_message.id is null then return false; end if;

  if p_event='open' then
    update public.energy_messages
    set opened_at=coalesce(opened_at,now()),
        status=case when status in ('sent','delivered') then 'opened' else status end,
        updated_at=now()
    where id=v_message.id;
    v_weight := 3;
    v_external := concat('email:',v_message.id,':open');
  else
    update public.energy_messages
    set clicked_at=coalesce(clicked_at,now()),
        opened_at=coalesce(opened_at,now()),
        status=case when status not in ('replied','bounced','failed') then 'clicked' else status end,
        updated_at=now()
    where id=v_message.id;
    v_weight := 15;
    v_external := concat('email:',v_message.id,':click:',md5(coalesce(p_url,'')));
  end if;

  insert into public.energy_email_events(message_id,event_type,url,user_agent)
  values(v_message.id,p_event,p_url,left(p_user_agent,500));

  insert into public.energy_intent_events(user_id,lead_id,source,event_type,weight,external_id,url,metadata)
  values(v_message.user_id,v_message.lead_id,'email',concat('email_',p_event),v_weight,v_external,p_url,
    jsonb_build_object('message_id',v_message.id,'campaign_id',v_message.campaign_id,'mailbox_id',v_message.mailbox_id))
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.energy_track_email_event(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.energy_track_email_event(uuid,text,text,text) to service_role;
