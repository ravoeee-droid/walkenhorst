create or replace function public.energy_normalize_domain(p_url text)
returns text
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare v text;
begin
  v:=lower(btrim(coalesce(p_url,'')));
  if v='' then return null; end if;
  v:=regexp_replace(v,'^https?://','','i');
  v:=regexp_replace(v,'^www\.','','i');
  v:=split_part(v,'/',1);
  v:=split_part(v,'?',1);
  v:=regexp_replace(v,':[0-9]+$','','');
  if v='' then return null; end if;
  return v;
end;
$$;

create or replace function public.energy_normalize_company(p_name text)
returns text
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare v text;
begin
  v:=lower(btrim(coalesce(p_name,'')));
  if v='' then return null; end if;
  v:=regexp_replace(v,'\b(gmbh|mbh|ug|ag|kg|gbr|ohg|e\.k\.?|se|holding|gruppe|group)\b','','gi');
  v:=regexp_replace(v,'[^a-z0-9äöüß]+','','gi');
  if length(v)<3 then return null; end if;
  return v;
end;
$$;

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
    select id,company_name,city,postcode,email,phone,phone_e164,website,total_score,
           public.energy_normalize_domain(website) as domain_norm,
           public.energy_normalize_company(company_name) as company_norm,
           lower(btrim(coalesce(email,''))) as email_norm
    from public.energy_leads
    where user_id=(select auth.uid())
  ), pairs as (
    select a.*,b.id as b_id,b.company_name as b_company_name,b.city as b_city,b.postcode as b_postcode,
           b.email as b_email,b.phone as b_phone,b.phone_e164 as b_phone_e164,b.website as b_website,b.total_score as b_total_score,
           b.domain_norm as b_domain_norm,b.company_norm as b_company_norm,b.email_norm as b_email_norm,
           array_remove(array[
             case when a.email_norm<>'' and a.email_norm=b.email_norm then 'same_email' end,
             case when a.phone_e164 is not null and a.phone_e164=b.phone_e164 then 'same_phone' end,
             case when a.domain_norm is not null and a.domain_norm=b.domain_norm and coalesce(lower(a.city),'')=coalesce(lower(b.city),'') then 'same_domain_city' end,
             case when a.domain_norm is not null and a.domain_norm=b.domain_norm and coalesce(a.postcode,'')<>'' and a.postcode=b.postcode then 'same_domain_postcode' end,
             case when a.company_norm is not null and a.company_norm=b.company_norm and coalesce(a.postcode,'')<>'' and a.postcode=b.postcode then 'same_company_postcode' end,
             case when a.company_norm is not null and a.company_norm=b.company_norm and coalesce(lower(a.city),'')<>'' and lower(a.city)=lower(b.city) then 'same_company_city' end
           ],null) as match_reasons
    from mine a join mine b on a.id<b.id
    where
      (a.email_norm<>'' and a.email_norm=b.email_norm)
      or (a.phone_e164 is not null and a.phone_e164=b.phone_e164)
      or (a.domain_norm is not null and a.domain_norm=b.domain_norm and (coalesce(lower(a.city),'')=coalesce(lower(b.city),'') or (coalesce(a.postcode,'')<>'' and a.postcode=b.postcode)))
      or (a.company_norm is not null and a.company_norm=b.company_norm and ((coalesce(a.postcode,'')<>'' and a.postcode=b.postcode) or (coalesce(lower(a.city),'')<>'' and lower(a.city)=lower(b.city))))
  )
  select id,b_id,company_name,b_company_name,city,b_city,email,b_email,phone,b_phone,website,b_website,total_score,b_total_score,
         least(100,
           (case when 'same_email'=any(match_reasons) then 55 else 0 end)+
           (case when 'same_phone'=any(match_reasons) then 55 else 0 end)+
           (case when 'same_domain_city'=any(match_reasons) then 35 else 0 end)+
           (case when 'same_domain_postcode'=any(match_reasons) then 35 else 0 end)+
           (case when 'same_company_postcode'=any(match_reasons) then 35 else 0 end)+
           (case when 'same_company_city'=any(match_reasons) then 25 else 0 end)
         )::integer as confidence,
         match_reasons
  from pairs
  order by confidence desc,greatest(total_score,b_total_score) desc
  limit greatest(1,least(coalesce(p_limit,250),1000));
$$;

revoke all on function public.energy_find_duplicate_leads(integer) from public,anon;
grant execute on function public.energy_find_duplicate_leads(integer) to authenticated;

create or replace function public.energy_merge_leads(p_primary uuid,p_secondary uuid)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare
  v_user uuid:=(select auth.uid());
  p public.energy_leads%rowtype;
  s public.energy_leads%rowtype;
  r record;
  v_deal_conflict boolean;
  v_campaign_conflict boolean;
  v_status text;
  status_rank jsonb:='{"new":1,"research":2,"ready":3,"contacted":4,"nurture":4,"engaged":5,"qualified":6,"meeting":7,"proposal":8,"won":9,"lost":0}'::jsonb;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_primary is null or p_secondary is null or p_primary=p_secondary then raise exception 'two different leads required'; end if;
  select * into p from public.energy_leads where id=p_primary and user_id=v_user for update;
  select * into s from public.energy_leads where id=p_secondary and user_id=v_user for update;
  if p.id is null or s.id is null then raise exception 'lead not found'; end if;
  if (p.status in ('won','lost') or s.status in ('won','lost')) and p.status is distinct from s.status then raise exception 'cannot auto-merge conflicting closed lead states'; end if;

  select exists(select 1 from public.energy_deals d1 join public.energy_deals d2 on d1.user_id=d2.user_id where d1.lead_id=p.id and d2.lead_id=s.id and d1.user_id=v_user) into v_deal_conflict;
  if v_deal_conflict then raise exception 'both leads already have deals; manual review required'; end if;

  select exists(select 1 from public.energy_campaign_members a join public.energy_campaign_members b on a.campaign_id=b.campaign_id where a.lead_id=p.id and b.lead_id=s.id) into v_campaign_conflict;
  if v_campaign_conflict then raise exception 'both leads are in the same campaign; manual review required'; end if;

  v_status:=case when coalesce((status_rank->>p.status)::int,0)>=coalesce((status_rank->>s.status)::int,0) then p.status else s.status end;

  update public.energy_leads set
    website=coalesce(p.website,s.website),
    city=coalesce(p.city,s.city),
    industry=coalesce(p.industry,s.industry),
    employees=coalesce(p.employees,s.employees),
    location_count=greatest(coalesce(p.location_count,1),coalesce(s.location_count,1)),
    roof_area_m2=coalesce(p.roof_area_m2,s.roof_area_m2),
    annual_energy_kwh=coalesce(p.annual_energy_kwh,s.annual_energy_kwh),
    pv_present=coalesce(p.pv_present,s.pv_present),
    contact_name=coalesce(p.contact_name,s.contact_name),
    contact_title=coalesce(p.contact_title,s.contact_title),
    phone=case when coalesce(p.phone,'')='' or coalesce(p.metadata->>'phone_status','')='invalid' then coalesce(s.phone,p.phone) else p.phone end,
    email=case when coalesce(p.email,'')='' or p.email_status='invalid' then coalesce(nullif(s.email,''),p.email) else p.email end,
    email_status=case when p.email_status='valid' then p.email_status when s.email_status='valid' then s.email_status when p.email_status='invalid' and s.email_status is distinct from 'invalid' then s.email_status else p.email_status end,
    address=coalesce(p.address,s.address),
    postcode=coalesce(p.postcode,s.postcode),
    pv_score=greatest(coalesce(p.pv_score,0),coalesce(s.pv_score,0)),
    energy_score=greatest(coalesce(p.energy_score,0),coalesce(s.energy_score,0)),
    intent_score=greatest(coalesce(p.intent_score,0),coalesce(s.intent_score,0)),
    contactability_score=greatest(coalesce(p.contactability_score,0),coalesce(s.contactability_score,0)),
    total_score=greatest(coalesce(p.total_score,0),coalesce(s.total_score,0)),
    summary=coalesce(p.summary,s.summary),pitch=coalesce(p.pitch,s.pitch),next_action=coalesce(p.next_action,s.next_action),
    status=v_status,
    research_context=coalesce(p.research_context,s.research_context),
    enriched_at=greatest(p.enriched_at,s.enriched_at),
    email_verified_at=greatest(p.email_verified_at,s.email_verified_at),
    last_contact_at=greatest(p.last_contact_at,s.last_contact_at),
    last_replied_at=greatest(p.last_replied_at,s.last_replied_at),
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('merged_from_lead_id',s.id,'merged_from_company',s.company_name,'merged_at',now()),
    updated_at=now()
  where id=p.id and user_id=v_user;

  for r in
    select c.conrelid::regclass::text as tbl,a.attname as col
    from pg_constraint c
    join unnest(c.conkey) with ordinality ck(attnum,ord) on true
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=ck.attnum
    where c.contype='f' and c.confrelid='public.energy_leads'::regclass
      and c.conrelid<>'public.energy_leads'::regclass
  loop
    execute format('update %s set %I=$1 where %I=$2',r.tbl,r.col,r.col) using p.id,s.id;
  end loop;

  delete from public.energy_leads where id=s.id and user_id=v_user;
  insert into public.energy_activities(user_id,lead_id,activity_type,title,detail,metadata)
  values(v_user,p.id,'lead_merged','Dubletten zusammengeführt',s.company_name||' wurde in diesen Lead übernommen.',jsonb_build_object('secondary_id',s.id,'secondary_company',s.company_name));
  return jsonb_build_object('ok',true,'primary_id',p.id,'merged_id',s.id,'company',p.company_name);
exception when unique_violation then
  raise exception 'merge conflict: duplicate child records require manual review';
end;
$$;

revoke all on function public.energy_merge_leads(uuid,uuid) from public,anon;
grant execute on function public.energy_merge_leads(uuid,uuid) to authenticated;
