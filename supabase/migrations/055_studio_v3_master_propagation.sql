create or replace function public.energy_propagate_global_studio_config()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.scope <> 'global' or new.lead_id is not null then return new; end if;
  perform set_config('app.studio_propagating','1',true);
  insert into public.energy_studio_configs(
    user_id,lead_id,scope,template_key,name,config,inherits_global,brand_kit_id,
    autosave_revision,published_revision,last_autosaved_at,landing_enabled,created_at,updated_at
  )
  select new.user_id,l.id,'lead',new.template_key,new.name,new.config,true,new.brand_kit_id,
         new.autosave_revision,new.published_revision,new.last_autosaved_at,new.landing_enabled,now(),now()
  from public.energy_leads l
  where l.user_id=new.user_id
  on conflict do nothing;
  update public.energy_studio_configs c
  set name=new.name,
      config=new.config,
      brand_kit_id=new.brand_kit_id,
      autosave_revision=new.autosave_revision,
      published_revision=new.published_revision,
      last_autosaved_at=new.last_autosaved_at,
      landing_enabled=new.landing_enabled,
      inherits_global=true,
      updated_at=now()
  where c.user_id=new.user_id
    and c.scope='lead'
    and c.template_key=new.template_key
    and c.inherits_global=true;
  perform set_config('app.studio_propagating','0',true);
  return new;
exception when others then
  perform set_config('app.studio_propagating','0',true);
  raise;
end;
$$;

create or replace function public.energy_seed_studio_for_new_lead()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$;
