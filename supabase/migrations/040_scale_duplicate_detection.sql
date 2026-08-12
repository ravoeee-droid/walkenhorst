alter table public.energy_leads add column if not exists email_norm text;
alter table public.energy_leads add column if not exists domain_norm text;
alter table public.energy_leads add column if not exists company_norm text;

update public.energy_leads
set email_norm=nullif(lower(btrim(coalesce(email,''))),''),
    domain_norm=public.energy_normalize_domain(website),
    company_norm=public.energy_normalize_company(company_name)
where email_norm is distinct from nullif(lower(btrim(coalesce(email,''))),'')
   or domain_norm is distinct from public.energy_normalize_domain(website)
   or company_norm is distinct from public.energy_normalize_company(company_name);

create or replace function public.energy_sync_lead_norms()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
begin
  new.email_norm:=nullif(lower(btrim(coalesce(new.email,''))),'');
  new.domain_norm:=public.energy_normalize_domain(new.website);
  new.company_norm:=public.energy_normalize_company(new.company_name);
  return new;
end;
$$;

drop trigger if exists energy_leads_norms_trg on public.energy_leads;
create trigger energy_leads_norms_trg
before insert or update of email,website,company_name on public.energy_leads
for each row execute function public.energy_sync_lead_norms();

create index if not exists energy_leads_user_email_norm_idx on public.energy_leads(user_id,email_norm) where email_norm is not null;
create index if not exists energy_leads_user_domain_city_idx on public.energy_leads(user_id,domain_norm,lower(city)) where domain_norm is not null and city is not null;
create index if not exists energy_leads_user_domain_postcode_idx on public.energy_leads(user_id,domain_norm,postcode) where domain_norm is not null and postcode is not null;
create index if not exists energy_leads_user_company_city_idx on public.energy_leads(user_id,company_norm,lower(city)) where company_norm is not null and city is not null;
create index if not exists energy_leads_user_company_postcode_idx on public.energy_leads(user_id,company_norm,postcode) where company_norm is not null and postcode is not null;

create or replace function public.energy_find_duplicate_leads(p_limit integer default 250)
returns table(
  lead_a uuid,
  lead_b uuid,
  company_a text,
  company_b text,
  city_a text,
  city_b text,
  email_a text,
  email_b text,
  phone_a text,
  phone_b text,
  website_a text,
  website_b text,
  score_a integer,
  score_b integer,
  confidence integer,
  reasons text[]
)
language sql
security invoker
set search_path=public,pg_catalog
as $$
  with mine as (
    select id,user_id,company_name,city,postcode,email,email_norm,phone,phone_e164,website,domain_norm,company_norm,total_score
    from public.energy_leads
    where user_id=(select auth.uid())
  ), raw_pairs as (
    select least(a.id,b.id) a_id,greatest(a.id,b.id) b_id,'same_email'::text reason
    from mine a join mine b on a.email_norm=b.email_norm and a.id<b.id where a.email_norm is not null
    union all
    select least(a.id,b.id),greatest(a.id,b.id),'same_phone'
    from mine a join mine b on a.phone_e164=b.phone_e164 and a.id<b.id where a.phone_e164 is not null
    union all
    select least(a.id,b.id),greatest(a.id,b.id),'same_domain_city'
    from mine a join mine b on a.domain_norm=b.domain_norm and lower(a.city)=lower(b.city) and a.id<b.id where a.domain_norm is not null and a.city is not null
    union all
    select least(a.id,b.id),greatest(a.id,b.id),'same_domain_postcode'
    from mine a join mine b on a.domain_norm=b.domain_norm and a.postcode=b.postcode and a.id<b.id where a.domain_norm is not null and a.postcode is not null
    union all
    select least(a.id,b.id),greatest(a.id,b.id),'same_company_postcode'
    from mine a join mine b on a.company_norm=b.company_norm and a.postcode=b.postcode and a.id<b.id where a.company_norm is not null and a.postcode is not null
    union all
    select least(a.id,b.id),greatest(a.id,b.id),'same_company_city'
    from mine a join mine b on a.company_norm=b.company_norm and lower(a.city)=lower(b.city) and a.id<b.id where a.company_norm is not null and a.city is not null
  ), grouped as (
    select a_id,b_id,array_agg(distinct reason order by reason) as match_reasons
    from raw_pairs group by a_id,b_id
  )
  select a.id,b.id,a.company_name,b.company_name,a.city,b.city,a.email,b.email,a.phone,b.phone,a.website,b.website,a.total_score,b.total_score,
    least(100,
      (case when 'same_email'=any(g.match_reasons) then 55 else 0 end)+
      (case when 'same_phone'=any(g.match_reasons) then 55 else 0 end)+
      (case when 'same_domain_city'=any(g.match_reasons) then 35 else 0 end)+
      (case when 'same_domain_postcode'=any(g.match_reasons) then 35 else 0 end)+
      (case when 'same_company_postcode'=any(g.match_reasons) then 35 else 0 end)+
      (case when 'same_company_city'=any(g.match_reasons) then 25 else 0 end)
    )::integer,
    g.match_reasons
  from grouped g
  join mine a on a.id=g.a_id
  join mine b on b.id=g.b_id
  order by 15 desc,greatest(a.total_score,b.total_score) desc
  limit greatest(1,least(coalesce(p_limit,250),1000));
$$;
