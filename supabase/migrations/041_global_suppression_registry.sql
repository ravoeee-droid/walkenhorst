create table if not exists public.energy_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('email','phone','domain')),
  raw_value text not null,
  value_norm text not null,
  reason text not null default 'manual',
  source text not null default 'manual',
  block_all boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,kind,value_norm)
);

create index if not exists energy_suppressions_user_active_idx on public.energy_suppressions(user_id,active,kind,value_norm);
alter table public.energy_suppressions enable row level security;
drop policy if exists "suppression owner access" on public.energy_suppressions;
create policy "suppression owner access" on public.energy_suppressions
for all to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

create or replace function public.energy_normalize_suppression(p_kind text,p_value text)
returns text
language plpgsql
immutable
set search_path=public,pg_catalog
as $$
declare v text;
begin
  if p_kind='email' then
    v:=nullif(lower(btrim(coalesce(p_value,''))),'');
  elsif p_kind='phone' then
    v:=public.energy_normalize_phone(p_value);
  elsif p_kind='domain' then
    v:=public.energy_normalize_domain(p_value);
  else
    v:=null;
  end if;
  return v;
end;
$$;

create or replace function public.energy_prepare_suppression()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
begin
  new.value_norm:=public.energy_normalize_suppression(new.kind,new.raw_value);
  if new.value_norm is null then raise exception 'invalid suppression value'; end if;
  new.updated_at:=now();
  return new;
end;
$$;

drop trigger if exists energy_suppression_prepare_trg on public.energy_suppressions;
create trigger energy_suppression_prepare_trg
before insert or update of kind,raw_value on public.energy_suppressions
for each row execute function public.energy_prepare_suppression();

create or replace function public.energy_apply_suppression_to_lead()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare
  v_email text:=nullif(lower(btrim(coalesce(new.email,''))),'');
  v_phone text:=public.energy_normalize_phone(new.phone);
  v_domain text:=public.energy_normalize_domain(new.website);
  v_email_block boolean:=false;
  v_phone_block boolean:=false;
  v_all boolean:=false;
begin
  if v_email is not null then
    select coalesce(bool_or(true),false),coalesce(bool_or(block_all),false)
    into v_email_block,v_all
    from public.energy_suppressions s
    where s.user_id=new.user_id and s.active and s.kind='email' and s.value_norm=v_email;
  end if;
  if v_domain is not null then
    select v_email_block or coalesce(bool_or(true),false),v_all or coalesce(bool_or(block_all),false)
    into v_email_block,v_all
    from public.energy_suppressions s
    where s.user_id=new.user_id and s.active and s.kind='domain' and s.value_norm=v_domain;
  end if;
  if v_phone is not null then
    select coalesce(bool_or(true),false),v_all or coalesce(bool_or(block_all),false)
    into v_phone_block,v_all
    from public.energy_suppressions s
    where s.user_id=new.user_id and s.active and s.kind='phone' and s.value_norm=v_phone;
  end if;

  if v_email_block then new.email_status:='invalid'; end if;
  if v_phone_block then new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('phone_status','invalid','phone_suppressed',true); end if;
  if v_all then new.do_not_contact:=true; end if;
  if v_email_block or v_phone_block or v_all then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('suppression_hit_at',now());
  end if;
  return new;
end;
$$;

drop trigger if exists energy_lead_suppression_guard_trg on public.energy_leads;
create trigger energy_lead_suppression_guard_trg
before insert or update of email,phone,website,user_id on public.energy_leads
for each row execute function public.energy_apply_suppression_to_lead();

create or replace function public.energy_capture_lead_suppression()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare
  v_email text:=nullif(lower(btrim(coalesce(new.email,''))),'');
  v_phone text:=public.energy_normalize_phone(new.phone);
begin
  if coalesce(new.do_not_contact,false) and (tg_op='INSERT' or old.do_not_contact is distinct from true) then
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

  if new.email_status='invalid' and (tg_op='INSERT' or old.email_status is distinct from 'invalid') and v_email is not null then
    insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
    values(new.user_id,'email',new.email,v_email,'invalid_email','lead',false,true)
    on conflict(user_id,kind,value_norm) do update set active=true,updated_at=now();
  end if;

  if coalesce(new.metadata->>'phone_status','')='invalid' and (tg_op='INSERT' or coalesce(old.metadata->>'phone_status','') is distinct from 'invalid') and v_phone is not null then
    insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
    values(new.user_id,'phone',new.phone,v_phone,'invalid_phone','lead',false,true)
    on conflict(user_id,kind,value_norm) do update set active=true,updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists energy_lead_capture_suppression_trg on public.energy_leads;
create trigger energy_lead_capture_suppression_trg
after insert or update of do_not_contact,email_status,metadata on public.energy_leads
for each row execute function public.energy_capture_lead_suppression();

insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
select user_id,'email',email,lower(btrim(email)),'existing_do_not_contact','backfill',true,true
from public.energy_leads
where do_not_contact=true and nullif(btrim(coalesce(email,'')),'') is not null
on conflict(user_id,kind,value_norm) do update set active=true,block_all=true,updated_at=now();

insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
select user_id,'email',email,lower(btrim(email)),'invalid_email','backfill',false,true
from public.energy_leads
where email_status='invalid' and nullif(btrim(coalesce(email,'')),'') is not null
on conflict(user_id,kind,value_norm) do nothing;

insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
select user_id,'phone',phone,public.energy_normalize_phone(phone),'invalid_phone','backfill',false,true
from public.energy_leads
where coalesce(metadata->>'phone_status','')='invalid' and public.energy_normalize_phone(phone) is not null
on conflict(user_id,kind,value_norm) do nothing;

create or replace function public.energy_add_suppression(p_kind text,p_value text,p_reason text default 'manual',p_block_all boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare v_user uuid:=(select auth.uid());v_norm text;v_id uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_kind not in ('email','phone','domain') then raise exception 'invalid suppression kind'; end if;
  v_norm:=public.energy_normalize_suppression(p_kind,p_value);if v_norm is null then raise exception 'invalid suppression value'; end if;
  insert into public.energy_suppressions(user_id,kind,raw_value,value_norm,reason,source,block_all,active)
  values(v_user,p_kind,p_value,v_norm,coalesce(nullif(left(p_reason,200),''),'manual'),'manual',coalesce(p_block_all,false),true)
  on conflict(user_id,kind,value_norm) do update set active=true,raw_value=excluded.raw_value,reason=excluded.reason,block_all=excluded.block_all,updated_at=now()
  returning id into v_id;

  if p_kind='email' then update public.energy_leads set email_status='invalid',do_not_contact=case when p_block_all then true else do_not_contact end,updated_at=now() where user_id=v_user and email_norm=v_norm;
  elsif p_kind='phone' then update public.energy_leads set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phone_status','invalid','phone_suppressed',true),do_not_contact=case when p_block_all then true else do_not_contact end,updated_at=now() where user_id=v_user and phone_e164=v_norm;
  elsif p_kind='domain' then update public.energy_leads set email_status='invalid',do_not_contact=case when p_block_all then true else do_not_contact end,updated_at=now() where user_id=v_user and domain_norm=v_norm;
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'kind',p_kind,'value_norm',v_norm);
end;
$$;

create or replace function public.energy_disable_suppression(p_id uuid)
returns boolean
language sql
security invoker
set search_path=public,pg_catalog
as $$
  update public.energy_suppressions set active=false,updated_at=now() where id=p_id and user_id=(select auth.uid()) returning true;
$$;

revoke all on function public.energy_add_suppression(text,text,text,boolean) from public,anon;
grant execute on function public.energy_add_suppression(text,text,text,boolean) to authenticated;
revoke all on function public.energy_disable_suppression(uuid) from public,anon;
grant execute on function public.energy_disable_suppression(uuid) to authenticated;
