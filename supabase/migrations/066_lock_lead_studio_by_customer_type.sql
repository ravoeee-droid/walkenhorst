create or replace function public.energy_lock_lead_studio_by_customer_type()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.customer_type = 'private' then
    new.video_template_key := 'pv-privat';
  else
    new.customer_type := 'commercial';
    new.video_template_key := 'energiekosten';
  end if;
  return new;
end;
$$;

drop trigger if exists energy_lock_lead_studio_by_customer_type_trigger on public.energy_leads;
create trigger energy_lock_lead_studio_by_customer_type_trigger
before insert or update of customer_type, video_template_key
on public.energy_leads
for each row execute function public.energy_lock_lead_studio_by_customer_type();

update public.energy_leads
set video_template_key = case when customer_type = 'private' then 'pv-privat' else 'energiekosten' end
where video_template_key is distinct from case when customer_type = 'private' then 'pv-privat' else 'energiekosten' end;
