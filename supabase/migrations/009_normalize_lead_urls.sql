create or replace function public.energy_normalize_lead_urls()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.website is not null and btrim(new.website) <> '' and new.website !~* '^https?://' then
    new.website := 'https://' || btrim(new.website);
  end if;
  if new.linkedin_url is not null and btrim(new.linkedin_url) <> '' and new.linkedin_url !~* '^https?://' then
    new.linkedin_url := 'https://' || btrim(new.linkedin_url);
  end if;
  return new;
end;
$$;
revoke all on function public.energy_normalize_lead_urls() from public,anon,authenticated;
drop trigger if exists energy_normalize_lead_urls_trigger on public.energy_leads;
create trigger energy_normalize_lead_urls_trigger before insert or update of website,linkedin_url on public.energy_leads for each row execute function public.energy_normalize_lead_urls();
update public.energy_leads set website=website where website is not null and btrim(website)<>'';
