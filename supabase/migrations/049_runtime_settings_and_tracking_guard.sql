create table if not exists public.energy_runtime_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_base_url text,
  default_timezone text not null default 'Europe/Berlin',
  updated_at timestamptz not null default now(),
  constraint energy_runtime_settings_public_base_url_check check (public_base_url is null or public_base_url ~ '^https://[^[:space:]]+$')
);

alter table public.energy_runtime_settings enable row level security;

drop policy if exists "runtime settings owner access" on public.energy_runtime_settings;
create policy "runtime settings owner access" on public.energy_runtime_settings
for all to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

grant select,insert,update,delete on public.energy_runtime_settings to authenticated;

create or replace function public.energy_apply_campaign_runtime_settings()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_base text;
  v_timezone text;
begin
  select nullif(regexp_replace(public_base_url, '/+$', ''),''), default_timezone
    into v_base,v_timezone
  from public.energy_runtime_settings
  where user_id=new.user_id;

  if v_base is not null then
    new.tracking_base_url:=v_base;
  elsif new.tracking_base_url is not null then
    new.tracking_base_url:=regexp_replace(new.tracking_base_url,'/+$','');
  end if;

  if v_timezone is not null then new.timezone:=v_timezone; end if;

  if new.status='active' and (new.tracking_base_url is null or new.tracking_base_url !~ '^https://[^[:space:]]+$') then
    raise exception 'Öffentliche App-URL fehlt. Bitte zuerst unter Einstellungen eine HTTPS-Produktions-URL speichern.';
  end if;
  return new;
end;
$$;

drop trigger if exists energy_campaign_runtime_settings_trigger on public.energy_campaigns;
create trigger energy_campaign_runtime_settings_trigger
before insert or update of tracking_base_url,status,timezone
on public.energy_campaigns
for each row execute function public.energy_apply_campaign_runtime_settings();
