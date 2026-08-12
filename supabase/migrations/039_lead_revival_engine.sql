create or replace function public.energy_revival_candidates(p_limit integer default 250)
returns table(
  lead_id uuid,
  company_name text,
  contact_name text,
  phone text,
  email text,
  status text,
  total_score integer,
  intent_score integer,
  last_contact_at timestamptz,
  days_inactive integer,
  reason text,
  priority integer,
  suggested_action text
)
language sql
security invoker
set search_path=public,pg_catalog
as $$
  with mine as (
    select l.*,
      greatest(0,floor(extract(epoch from (now()-coalesce(l.last_contact_at,l.updated_at,l.created_at)))/86400))::int as inactive_days,
      d.stage as deal_stage,d.lost_reason,d.lost_at
    from public.energy_leads l
    left join lateral (
      select stage,lost_reason,lost_at
      from public.energy_deals d
      where d.user_id=l.user_id and d.lead_id=l.id
      order by d.updated_at desc limit 1
    ) d on true
    where l.user_id=(select auth.uid())
      and coalesce(l.do_not_contact,false)=false
      and coalesce(l.total_score,0)>=60
      and (
        (coalesce(l.phone,'')<>'' and coalesce(l.metadata->>'phone_status','')<>'invalid')
        or (coalesce(l.email,'')<>'' and coalesce(l.email_status,'unknown')<>'invalid')
      )
      and not exists(select 1 from public.energy_followups f where f.user_id=l.user_id and f.lead_id=l.id and f.status='open')
      and not exists(select 1 from public.energy_campaign_members cm join public.energy_campaigns c on c.id=cm.campaign_id where cm.lead_id=l.id and cm.status='queued' and c.status='active')
  ), candidates as (
    select *,
      case
        when status='lost' and lost_reason in ('Timing / später','Keine Rückmeldung') and coalesce(lost_at,last_contact_at,updated_at)<now()-interval '30 days' then 'closed_timing_revisit'
        when status='engaged' and coalesce(last_contact_at,updated_at)<now()-interval '7 days' then 'engaged_stale'
        when status='nurture' and coalesce(last_contact_at,updated_at)<now()-interval '14 days' then 'nurture_due'
        when status='contacted' and coalesce(last_contact_at,updated_at)<now()-interval '14 days' then 'contacted_no_reply'
        else null
      end as revival_reason
    from mine
    where deal_stage is null or deal_stage not in ('won','proposal','negotiation','meeting')
  )
  select id,company_name,contact_name,phone,email,status,total_score,intent_score,last_contact_at,inactive_days,
    case revival_reason
      when 'closed_timing_revisit' then coalesce(lost_reason,'Timing erneut prüfen')
      when 'engaged_stale' then 'Interesse vorhanden, aber Follow-up fehlt'
      when 'nurture_due' then 'Wiedervorlage ist lange inaktiv'
      when 'contacted_no_reply' then 'Kontaktversuch liegt mindestens 14 Tage zurück'
    end,
    (coalesce(total_score,0)*2 + coalesce(intent_score,0)*2 + least(inactive_days,90) + case revival_reason when 'engaged_stale' then 200 when 'closed_timing_revisit' then 150 when 'nurture_due' then 100 else 50 end)::int,
    case revival_reason
      when 'closed_timing_revisit' then 'Timing neu prüfen und mit aktuellem Energie-Potenzial einsteigen.'
      when 'engaged_stale' then 'Heute persönlich nachfassen – früheres Interesse konkretisieren.'
      when 'nurture_due' then 'Kurzen Re-Check durchführen und Wiedervorlage aktivieren.'
      when 'contacted_no_reply' then 'Neuen Kontaktversuch mit anderem Angle oder Kanal starten.'
    end
  from candidates
  where revival_reason is not null
  order by 13 desc
  limit greatest(1,least(coalesce(p_limit,250),1000));
$$;

revoke all on function public.energy_revival_candidates(integer) from public,anon;
grant execute on function public.energy_revival_candidates(integer) to authenticated;

create or replace function public.energy_revive_lead(p_lead_id uuid,p_due_at timestamptz default now(),p_note text default null)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare
  v_user uuid:=(select auth.uid());
  l public.energy_leads%rowtype;
  v_followup uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select * into l from public.energy_leads where id=p_lead_id and user_id=v_user for update;
  if l.id is null then raise exception 'lead not found'; end if;
  if coalesce(l.do_not_contact,false) then raise exception 'lead is do-not-contact'; end if;
  if coalesce(l.email_status,'unknown')='invalid' and (coalesce(l.phone,'')='' or coalesce(l.metadata->>'phone_status','')='invalid') then raise exception 'no valid contact channel'; end if;
  if exists(select 1 from public.energy_followups f where f.user_id=v_user and f.lead_id=l.id and f.status='open') then raise exception 'open follow-up already exists'; end if;
  if exists(select 1 from public.energy_campaign_members cm join public.energy_campaigns c on c.id=cm.campaign_id where cm.lead_id=l.id and cm.status='queued' and c.status='active') then raise exception 'lead is already in an active sequence'; end if;

  update public.energy_leads
  set status=case when l.status='engaged' then 'engaged' else 'nurture' end,
      next_action='Reaktivierung: persönlich nachfassen und aktuellen Bedarf/Timing neu qualifizieren.',
      metadata=coalesce(l.metadata,'{}'::jsonb)||jsonb_build_object('last_revival_at',now()),
      updated_at=now()
  where id=l.id and user_id=v_user;

  insert into public.energy_followups(user_id,lead_id,title,due_at,priority,status,reason)
  values(v_user,l.id,l.company_name||' reaktivieren',coalesce(p_due_at,now()),case when coalesce(l.intent_score,0)>=70 then 'hot' else 'high' end,'open',coalesce(nullif(left(p_note,500),''),'Stale Lead Revival'))
  returning id into v_followup;

  insert into public.energy_activities(user_id,lead_id,activity_type,title,detail,metadata)
  values(v_user,l.id,'lead_revival','Lead reaktiviert',coalesce(nullif(left(p_note,1000),''),'Neue Wiedervorlage aus Revival Engine erstellt.'),jsonb_build_object('followup_id',v_followup,'previous_status',l.status));

  return jsonb_build_object('ok',true,'lead_id',l.id,'followup_id',v_followup);
end;
$$;

revoke all on function public.energy_revive_lead(uuid,timestamptz,text) from public,anon;
grant execute on function public.energy_revive_lead(uuid,timestamptz,text) to authenticated;
