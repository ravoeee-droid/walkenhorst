alter table public.energy_studio_configs add column inherits_global boolean not null default false;

create or replace function public.energy_mark_studio_override()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.scope='lead' and new.scope='lead'
     and coalesce(current_setting('app.studio_propagating', true),'0') <> '1'
     and new.config is distinct from old.config then
    new.inherits_global := false;
  end if;
  return new;
end;
$$;

create trigger energy_studio_mark_override_before_update
before update on public.energy_studio_configs
for each row execute function public.energy_mark_studio_override();

create or replace function public.energy_propagate_global_studio_config()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.scope <> 'global' or new.lead_id is not null then return new; end if;
  perform set_config('app.studio_propagating','1',true);
  insert into public.energy_studio_configs(user_id,lead_id,scope,template_key,name,config,inherits_global,created_at,updated_at)
  select new.user_id,l.id,'lead',new.template_key,new.name,new.config,true,now(),now()
  from public.energy_leads l
  where l.user_id=new.user_id
  on conflict do nothing;
  update public.energy_studio_configs c
  set name=new.name,config=new.config,inherits_global=true,updated_at=now()
  where c.user_id=new.user_id and c.scope='lead' and c.template_key=new.template_key and c.inherits_global=true;
  return new;
end;
$$;

create trigger energy_studio_propagate_global_after_write
after insert or update of name,config on public.energy_studio_configs
for each row when (new.scope='global') execute function public.energy_propagate_global_studio_config();

create or replace function public.energy_seed_studio_for_new_lead()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('app.studio_propagating','1',true);
  insert into public.energy_studio_configs(user_id,lead_id,scope,template_key,name,config,inherits_global,created_at,updated_at)
  select g.user_id,new.id,'lead',g.template_key,g.name,g.config,true,now(),now()
  from public.energy_studio_configs g
  where g.user_id=new.user_id and g.scope='global' and g.lead_id is null
  on conflict do nothing;
  return new;
end;
$$;

create trigger energy_studio_seed_new_lead_after_insert
after insert on public.energy_leads
for each row execute function public.energy_seed_studio_for_new_lead();

revoke all on function public.energy_mark_studio_override() from public, anon, authenticated;
revoke all on function public.energy_propagate_global_studio_config() from public, anon, authenticated;
revoke all on function public.energy_seed_studio_for_new_lead() from public, anon, authenticated;
