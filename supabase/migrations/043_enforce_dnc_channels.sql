create or replace function public.energy_enforce_dnc_channels()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
begin
  if coalesce(new.do_not_contact,false) then
    if nullif(btrim(coalesce(new.email,'')),'') is not null then
      new.email_status:='invalid';
    end if;
    if nullif(btrim(coalesce(new.phone,'')),'') is not null then
      new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('phone_status','invalid','do_not_contact',true);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists energy_leads_dnc_channels_trg on public.energy_leads;
create trigger energy_leads_dnc_channels_trg
before insert or update of do_not_contact,email,phone on public.energy_leads
for each row execute function public.energy_enforce_dnc_channels();

update public.energy_leads
set email_status=case when nullif(btrim(coalesce(email,'')),'') is not null then 'invalid' else email_status end,
    metadata=case when nullif(btrim(coalesce(phone,'')),'') is not null then coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phone_status','invalid','do_not_contact',true) else metadata end,
    updated_at=now()
where do_not_contact=true
  and (
    (nullif(btrim(coalesce(email,'')),'') is not null and email_status is distinct from 'invalid')
    or (nullif(btrim(coalesce(phone,'')),'') is not null and coalesce(metadata->>'phone_status','')<>'invalid')
  );
