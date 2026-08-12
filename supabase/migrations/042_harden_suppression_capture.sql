create or replace function public.energy_capture_lead_suppression()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare
  v_email text:=nullif(lower(btrim(coalesce(new.email,''))),'');
  v_phone text:=public.energy_normalize_phone(new.phone);
  v_new_dnc boolean:=coalesce(new.do_not_contact,false);
  v_dnc_changed boolean:=false;
  v_email_invalid_changed boolean:=false;
  v_phone_invalid_changed boolean:=false;
begin
  if tg_op='INSERT' then
    v_dnc_changed:=v_new_dnc;
    v_email_invalid_changed:=new.email_status='invalid';
    v_phone_invalid_changed:=coalesce(new.metadata->>'phone_status','')='invalid';
  else
    v_dnc_changed:=v_new_dnc and old.do_not_contact is distinct from true;
    v_email_invalid_changed:=new.email_status='invalid' and old.email_status is distinct from 'invalid';
    v_phone_invalid_changed:=coalesce(new.metadata->>'phone_status','')='invalid' and coalesce(old.metadata->>'phone_status','') is distinct from 'invalid';
  end if;

  if v_dnc_changed then
    if v_email is not null then
      insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
      values(new.user_id,'email',new.email,v_email,'do_not_contact','lead',true,true)
      on conflict(user_id,kind,value_norm) do update set active=true,block_all=true,reason='do_not_contact',source='lead',updated_at=now();
    end if;
    if v_phone is not null then
      insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
      values(new.user_id,'phone',new.phone,v_phone,'do_not_contact','lead',true,true)
      on conflict(user_id,kind,value_norm) do update set active=true,block_all=true,reason='do_not_contact',source='lead',updated_at=now();
    end if;
  end if;

  if v_email_invalid_changed and v_email is not null then
    insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
    values(new.user_id,'email',new.email,v_email,'invalid_email','lead',false,true)
    on conflict(user_id,kind,value_norm) do update set active=true,updated_at=now();
  end if;

  if v_phone_invalid_changed and v_phone is not null then
    insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
    values(new.user_id,'phone',new.phone,v_phone,'invalid_phone','lead',false,true)
    on conflict(user_id,kind,value_norm) do update set active=true,updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists energy_lead_capture_suppression_trg on public.energy_leads;
drop trigger if exists energy_lead_capture_suppression_insert_trg on public.energy_leads;
drop trigger if exists energy_lead_capture_suppression_update_trg on public.energy_leads;
create trigger energy_lead_capture_suppression_insert_trg
after insert on public.energy_leads
for each row execute function public.energy_capture_lead_suppression();
create trigger energy_lead_capture_suppression_update_trg
after update of do_not_contact,email_status,metadata on public.energy_leads
for each row execute function public.energy_capture_lead_suppression();
