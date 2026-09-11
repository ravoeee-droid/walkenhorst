create or replace function public.assign_energy_lead_scrape_batch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_industry text := nullif(trim(coalesce(new.industry, '')), '');
  v_label text;
begin
  if new.batch_id is not null or new.source in ('manual', 'triveo') then
    return new;
  end if;

  select b.id into v_batch_id
  from public.energy_lead_batches b
  where b.user_id = new.user_id
    and b.kind = 'scrape'
    and coalesce(b.source, '') = coalesce(new.source, '')
    and coalesce(b.industry, '') = coalesce(v_industry, '')
    and coalesce(b.metadata->>'auto_import', 'false') = 'true'
    and b.created_at >= now() - interval '5 minutes'
  order by b.created_at desc
  limit 1;

  if v_batch_id is null then
    v_label := coalesce(v_industry, 'Ohne Branche') || ' · ' || to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI');
    insert into public.energy_lead_batches (user_id, name, kind, industry, source, scraped_at, metadata)
    values (new.user_id, v_label, 'scrape', v_industry, new.source, now(), jsonb_build_object('auto_import', true))
    returning id into v_batch_id;
  end if;

  new.batch_id := v_batch_id;
  return new;
end;
$$;

drop trigger if exists trg_assign_energy_lead_scrape_batch on public.energy_leads;
create trigger trg_assign_energy_lead_scrape_batch
before insert on public.energy_leads
for each row execute function public.assign_energy_lead_scrape_batch();

create index if not exists idx_energy_lead_batches_auto_group
on public.energy_lead_batches(user_id, source, industry, created_at desc)
where kind = 'scrape';
