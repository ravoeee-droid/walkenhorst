create or replace function public.energy_record_document_view(p_token uuid)
returns table(
  target_url text,
  new_view_count integer,
  intent_weight integer,
  document_id uuid,
  lead_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.energy_documents%rowtype;
  v_count integer;
  v_weight integer;
begin
  select * into v_doc
  from public.energy_documents
  where tracking_token=p_token and status<>'archived'
  for update;

  if v_doc.id is null then return; end if;
  if v_doc.share_url is null or v_doc.share_url !~* '^https?://' then return; end if;

  v_count := coalesce(v_doc.view_count,0)+1;
  v_weight := case when v_count>=3 then 30 when v_count=2 then 15 else 20 end;

  update public.energy_documents
  set status='viewed',
      view_count=v_count,
      first_viewed_at=coalesce(first_viewed_at,now()),
      last_viewed_at=now(),
      updated_at=now()
  where id=v_doc.id;

  insert into public.energy_intent_events(user_id,lead_id,source,event_type,weight,external_id,url,metadata)
  values(
    v_doc.user_id,
    v_doc.lead_id,
    'proposal',
    case when v_count>=3 then 'proposal_reopened_hot' else 'proposal_view' end,
    v_weight,
    concat('proposal:',v_doc.id,':view:',v_count),
    v_doc.share_url,
    jsonb_build_object('document_id',v_doc.id,'title',v_doc.title,'view_count',v_count)
  ) on conflict do nothing;

  return query select v_doc.share_url,v_count,v_weight,v_doc.id,v_doc.lead_id;
end;
$$;

revoke all on function public.energy_record_document_view(uuid) from public,anon,authenticated;
grant execute on function public.energy_record_document_view(uuid) to service_role;
