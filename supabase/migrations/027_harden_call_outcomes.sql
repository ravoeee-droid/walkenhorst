create or replace function public.energy_record_call_outcome(
  p_lead_id uuid,
  p_outcome text,
  p_note text default null,
  p_callback_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lead public.energy_leads%rowtype;
  v_status text;
  v_title text;
  v_due timestamptz;
  v_priority text;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_outcome not in ('no_answer','reached','interested','meeting','callback','not_interested','wrong_number') then raise exception 'invalid call outcome'; end if;

  select * into v_lead from public.energy_leads where id=p_lead_id and user_id=v_user for update;
  if v_lead.id is null then raise exception 'lead not found'; end if;

  v_status := case p_outcome
    when 'interested' then 'engaged'
    when 'meeting' then 'meeting'
    when 'callback' then 'nurture'
    when 'not_interested' then 'lost'
    when 'wrong_number' then 'research'
    else case when v_lead.status in ('new','research','ready') then 'contacted' else v_lead.status end
  end;
  v_title := case p_outcome
    when 'no_answer' then 'Anruf: nicht erreicht'
    when 'reached' then 'Anruf: erreicht'
    when 'interested' then 'Anruf: Interesse'
    when 'meeting' then 'Anruf: Termin vereinbart'
    when 'callback' then 'Anruf: Rückruf vereinbart'
    when 'not_interested' then 'Anruf: kein Interesse'
    when 'wrong_number' then 'Anruf: falsche Nummer'
  end;

  update public.energy_leads
  set status=v_status,
      last_contact_at=now(),
      metadata=case when p_outcome='wrong_number' then coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phone_status','invalid','invalid_phone',phone,'phone_checked_at',now()) else metadata end,
      next_action=case p_outcome
        when 'interested' then 'Interessent zeitnah persönlich nachfassen und konkreten Potenzialcheck terminieren.'
        when 'meeting' then 'Termin vorbereiten: Verbrauch, Lastprofil, Dachfläche und bestehende Energielösungen prüfen.'
        when 'callback' then 'Zum vereinbarten Zeitpunkt zurückrufen.'
        when 'no_answer' then 'Erneut anrufen und parallel personalisierte Analyse senden.'
        when 'wrong_number' then 'Telefonnummer recherchieren und Kontaktweg korrigieren.'
        when 'not_interested' then 'Aktiven Outbound stoppen.'
        else next_action end,
      updated_at=now()
  where id=v_lead.id;

  update public.energy_followups
  set status='done',completed_at=coalesce(completed_at,now())
  where user_id=v_user and lead_id=v_lead.id and status='open';

  insert into public.energy_activities(user_id,lead_id,activity_type,title,detail,metadata)
  values(v_user,v_lead.id,'call_outcome',v_title,nullif(left(coalesce(p_note,''),1000),''),jsonb_build_object('outcome',p_outcome,'callback_at',p_callback_at));

  if p_outcome='not_interested' then
    update public.energy_campaign_members set status='stopped',stopped_reason='call_not_interested',updated_at=now() where lead_id=v_lead.id and status='queued';
  end if;

  if p_outcome in ('no_answer','callback','interested') then
    v_due := case when p_outcome='callback' then coalesce(p_callback_at,now()+interval '1 day') when p_outcome='interested' then now() else now()+interval '1 day' end;
    v_priority := case when p_outcome='interested' or coalesce(v_lead.intent_score,0)>=70 then 'hot' else 'high' end;
    insert into public.energy_followups(user_id,lead_id,title,due_at,priority,status,reason)
    values(v_user,v_lead.id,case p_outcome when 'callback' then v_lead.company_name||' zurückrufen' when 'interested' then v_lead.company_name||' – Interesse nachfassen' else v_lead.company_name||' erneut anrufen' end,v_due,v_priority,'open',nullif(left(coalesce(p_note,v_title),500),''));
  end if;

  return jsonb_build_object('ok',true,'lead_id',v_lead.id,'status',v_status,'outcome',p_outcome);
end;
$$;

revoke all on function public.energy_record_call_outcome(uuid,text,text,timestamptz) from public, anon;
grant execute on function public.energy_record_call_outcome(uuid,text,text,timestamptz) to authenticated;
