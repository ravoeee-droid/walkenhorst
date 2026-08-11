create table if not exists public.energy_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_maps','firecrawl','reacher','chatwoot','activepieces','papermark','dub','openreplay','typebot','twenty','warmbly','denshees')),
  label text,
  base_url text,
  status text not null default 'setup' check (status in ('setup','ready','error','disabled')),
  config jsonb not null default '{}'::jsonb,
  secret_id uuid,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

alter table public.energy_integrations enable row level security;

drop policy if exists "integrations owner" on public.energy_integrations;
create policy "integrations owner"
  on public.energy_integrations
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.energy_integrations to authenticated;

create index if not exists energy_integrations_user_provider_idx
  on public.energy_integrations(user_id, provider);

alter table public.energy_lead_searches
  add column if not exists provider text not null default 'openstreetmap',
  add column if not exists external_job_id text,
  add column if not exists status text not null default 'completed',
  add column if not exists error text,
  add column if not exists completed_at timestamptz;

alter table public.energy_leads
  add column if not exists research_context jsonb not null default '{}'::jsonb,
  add column if not exists enriched_at timestamptz,
  add column if not exists email_verified_at timestamptz;

create index if not exists energy_lead_searches_user_status_idx
  on public.energy_lead_searches(user_id, status, created_at desc);

create or replace function public.energy_store_integration_secret(
  p_integration_id uuid,
  p_user_id uuid,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing uuid;
  v_secret_id uuid;
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'Secret darf nicht leer sein';
  end if;

  select secret_id into v_existing
  from public.energy_integrations
  where id = p_integration_id and user_id = p_user_id;

  if not found then
    raise exception 'Integration nicht gefunden';
  end if;

  if v_existing is null then
    select vault.create_secret(p_secret) into v_secret_id;
  else
    perform vault.update_secret(v_existing, p_secret);
    v_secret_id := v_existing;
  end if;

  update public.energy_integrations
  set secret_id = v_secret_id, updated_at = now()
  where id = p_integration_id and user_id = p_user_id;

  return v_secret_id;
end;
$$;

create or replace function public.energy_get_integration_secret(
  p_integration_id uuid,
  p_user_id uuid
)
returns text
language sql
security definer
set search_path = public, vault
stable
as $$
  select ds.decrypted_secret
  from public.energy_integrations i
  join vault.decrypted_secrets ds on ds.id = i.secret_id
  where i.id = p_integration_id
    and i.user_id = p_user_id
  limit 1;
$$;

revoke all on function public.energy_store_integration_secret(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.energy_get_integration_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function public.energy_store_integration_secret(uuid, uuid, text) to service_role;
grant execute on function public.energy_get_integration_secret(uuid, uuid) to service_role;
