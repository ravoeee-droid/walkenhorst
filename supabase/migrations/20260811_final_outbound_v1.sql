-- Walkenhorst Sales OS · production outbound v1
-- Additive migration: keeps all existing leads, videos and campaigns intact.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.energy_leads
  add column if not exists source text not null default 'manual',
  add column if not exists source_external_id text,
  add column if not exists source_url text,
  add column if not exists address text,
  add column if not exists postcode text,
  add column if not exists country text not null default 'DE',
  add column if not exists contact_title text,
  add column if not exists linkedin_url text,
  add column if not exists email_status text not null default 'unknown',
  add column if not exists website_score smallint,
  add column if not exists seo_score smallint,
  add column if not exists company_fit_score smallint,
  add column if not exists last_contact_at timestamptz,
  add column if not exists last_replied_at timestamptz,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.energy_mailboxes
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer not null default 587,
  add column if not exists smtp_secure boolean not null default false,
  add column if not exists smtp_username text,
  add column if not exists smtp_secret_id uuid,
  add column if not exists imap_host text,
  add column if not exists imap_port integer not null default 993,
  add column if not exists imap_secure boolean not null default true,
  add column if not exists imap_username text,
  add column if not exists imap_secret_id uuid,
  add column if not exists reply_to text,
  add column if not exists sent_today integer not null default 0,
  add column if not exists sent_today_on date,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.energy_campaigns
  add column if not exists tracking_base_url text,
  add column if not exists include_video boolean not null default true,
  add column if not exists auto_personalize boolean not null default true,
  add column if not exists reply_stops_sequence boolean not null default true,
  add column if not exists send_window_start time not null default '08:30',
  add column if not exists send_window_end time not null default '17:30',
  add column if not exists timezone text not null default 'Europe/Berlin',
  add column if not exists lead_filter jsonb not null default '{}'::jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.energy_campaign_members
  add column if not exists current_step integer not null default 1,
  add column if not exists next_step_at timestamptz,
  add column if not exists stopped_reason text,
  add column if not exists reply_status text,
  add column if not exists last_message_id uuid,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.energy_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.energy_campaigns(id) on delete cascade,
  step_order smallint not null check (step_order between 1 and 20),
  step_type text not null default 'email' check (step_type in ('email','video_email','manual_call','wait')),
  delay_hours integer not null default 0 check (delay_hours between 0 and 8760),
  subject_template text,
  body_template text,
  include_video boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(campaign_id, step_order)
);

create table if not exists public.energy_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete set null,
  campaign_member_id uuid references public.energy_campaign_members(id) on delete set null,
  mailbox_id uuid references public.energy_mailboxes(id) on delete set null,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','opened','clicked','replied','bounced','failed','skipped')),
  to_email text,
  from_email text,
  subject text,
  body_text text,
  body_html text,
  provider_message_id text,
  tracking_token uuid not null default gen_random_uuid() unique,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_email_events (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.energy_messages(id) on delete cascade,
  event_type text not null check (event_type in ('open','click','reply','bounce','unsubscribe')),
  url text,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.energy_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete set null,
  activity_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.energy_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete set null,
  title text not null,
  due_at timestamptz not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','hot')),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.energy_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  template_type text not null default 'email' check (template_type in ('email','video','call')),
  subject_template text,
  body_template text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_lead_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  location text,
  radius_km integer,
  result_count integer not null default 0,
  imported_count integer not null default 0,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists energy_leads_user_email_idx on public.energy_leads(user_id,email) where email is not null;
create index if not exists energy_leads_user_dnc_idx on public.energy_leads(user_id,do_not_contact,total_score desc);
create index if not exists energy_campaign_steps_campaign_order_idx on public.energy_campaign_steps(campaign_id,step_order);
create index if not exists energy_campaign_members_due_idx on public.energy_campaign_members(status,next_step_at) where status = 'queued';
create index if not exists energy_messages_user_status_due_idx on public.energy_messages(user_id,status,scheduled_at);
create index if not exists energy_messages_lead_created_idx on public.energy_messages(lead_id,created_at desc);
create index if not exists energy_messages_campaign_idx on public.energy_messages(campaign_id,status);
create index if not exists energy_messages_mailbox_idx on public.energy_messages(mailbox_id,sent_at desc);
create index if not exists energy_email_events_message_idx on public.energy_email_events(message_id,created_at desc);
create index if not exists energy_activities_user_created_idx on public.energy_activities(user_id,created_at desc);
create index if not exists energy_activities_lead_idx on public.energy_activities(lead_id,created_at desc);
create index if not exists energy_followups_user_due_idx on public.energy_followups(user_id,status,due_at);
create index if not exists energy_templates_user_idx on public.energy_templates(user_id,template_type);
create index if not exists energy_lead_searches_user_idx on public.energy_lead_searches(user_id,created_at desc);

alter table public.energy_campaign_steps enable row level security;
alter table public.energy_messages enable row level security;
alter table public.energy_email_events enable row level security;
alter table public.energy_activities enable row level security;
alter table public.energy_followups enable row level security;
alter table public.energy_templates enable row level security;
alter table public.energy_lead_searches enable row level security;

-- Ownership policies. Drop first so the migration is safely repeatable.
drop policy if exists "campaign steps owner access" on public.energy_campaign_steps;
create policy "campaign steps owner access" on public.energy_campaign_steps for all to authenticated
using (exists(select 1 from public.energy_campaigns c where c.id=campaign_id and c.user_id=(select auth.uid())))
with check (exists(select 1 from public.energy_campaigns c where c.id=campaign_id and c.user_id=(select auth.uid())));

drop policy if exists "message owner access" on public.energy_messages;
create policy "message owner access" on public.energy_messages for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

drop policy if exists "email event owner read" on public.energy_email_events;
create policy "email event owner read" on public.energy_email_events for select to authenticated
using (exists(select 1 from public.energy_messages m where m.id=message_id and m.user_id=(select auth.uid())));

drop policy if exists "activity owner access" on public.energy_activities;
create policy "activity owner access" on public.energy_activities for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

drop policy if exists "followup owner access" on public.energy_followups;
create policy "followup owner access" on public.energy_followups for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

drop policy if exists "template owner access" on public.energy_templates;
create policy "template owner access" on public.energy_templates for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

drop policy if exists "lead search owner access" on public.energy_lead_searches;
create policy "lead search owner access" on public.energy_lead_searches for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

grant select,insert,update,delete on public.energy_campaign_steps to authenticated;
grant select,insert,update,delete on public.energy_messages to authenticated;
grant select on public.energy_email_events to authenticated;
grant select,insert,update,delete on public.energy_activities to authenticated;
grant select,insert,update,delete on public.energy_followups to authenticated;
grant select,insert,update,delete on public.energy_templates to authenticated;
grant select,insert,update,delete on public.energy_lead_searches to authenticated;
grant usage,select on sequence public.energy_email_events_id_seq to authenticated;

-- Public tracking: token-scoped, no CRM data is returned.
create or replace function public.energy_track_email_event(p_token uuid, p_event text, p_url text default null, p_user_agent text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.energy_messages%rowtype;
begin
  if p_event not in ('open','click') then return false; end if;
  select * into v_message from public.energy_messages where tracking_token=p_token limit 1;
  if v_message.id is null then return false; end if;

  if p_event='open' then
    update public.energy_messages set opened_at=coalesce(opened_at,now()), status=case when status in ('sent','delivered') then 'opened' else status end, updated_at=now() where id=v_message.id;
  elsif p_event='click' then
    update public.energy_messages set clicked_at=coalesce(clicked_at,now()), opened_at=coalesce(opened_at,now()), status=case when status not in ('replied','bounced','failed') then 'clicked' else status end, updated_at=now() where id=v_message.id;
  end if;

  insert into public.energy_email_events(message_id,event_type,url,user_agent)
  values(v_message.id,p_event,p_url,left(p_user_agent,500));

  update public.energy_leads
  set intent_score=least(100,intent_score + case when p_event='click' then 15 else 5 end), updated_at=now()
  where id=v_message.lead_id;
  return true;
end;
$$;

create or replace function public.energy_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.energy_messages%rowtype;
begin
  select * into v_message from public.energy_messages where tracking_token=p_token limit 1;
  if v_message.id is null then return false; end if;
  update public.energy_leads set do_not_contact=true,unsubscribed_at=now(),updated_at=now() where id=v_message.lead_id;
  update public.energy_campaign_members set status='stopped',stopped_reason='unsubscribe',updated_at=now() where lead_id=v_message.lead_id and status not in ('completed','stopped');
  insert into public.energy_email_events(message_id,event_type) values(v_message.id,'unsubscribe');
  return true;
end;
$$;

revoke all on function public.energy_track_email_event(uuid,text,text,text) from public;
revoke all on function public.energy_unsubscribe(uuid) from public;
grant execute on function public.energy_track_email_event(uuid,text,text,text) to anon,authenticated;
grant execute on function public.energy_unsubscribe(uuid) to anon,authenticated;

-- Vault access is deliberately service-role only. Edge Functions verify the user first.
create or replace function public.energy_store_mailbox_secrets(
  p_mailbox_id uuid,
  p_user_id uuid,
  p_smtp_password text,
  p_imap_password text default null
)
returns boolean
language plpgsql
security definer
set search_path = public,vault
as $$
declare
  v_smtp_id uuid;
  v_imap_id uuid;
  v_existing_smtp uuid;
  v_existing_imap uuid;
begin
  if not exists(select 1 from public.energy_mailboxes where id=p_mailbox_id and user_id=p_user_id) then return false; end if;
  select smtp_secret_id,imap_secret_id into v_existing_smtp,v_existing_imap from public.energy_mailboxes where id=p_mailbox_id;

  if p_smtp_password is not null and length(p_smtp_password)>0 then
    if v_existing_smtp is null then
      select vault.create_secret(p_smtp_password,'energy_smtp_'||p_mailbox_id::text,'Walkenhorst SMTP password') into v_smtp_id;
    else
      perform vault.update_secret(v_existing_smtp,p_smtp_password);
      v_smtp_id:=v_existing_smtp;
    end if;
  else v_smtp_id:=v_existing_smtp; end if;

  if p_imap_password is not null and length(p_imap_password)>0 then
    if v_existing_imap is null then
      select vault.create_secret(p_imap_password,'energy_imap_'||p_mailbox_id::text,'Walkenhorst IMAP password') into v_imap_id;
    else
      perform vault.update_secret(v_existing_imap,p_imap_password);
      v_imap_id:=v_existing_imap;
    end if;
  else v_imap_id:=v_existing_imap; end if;

  update public.energy_mailboxes set smtp_secret_id=v_smtp_id,imap_secret_id=v_imap_id,updated_at=now() where id=p_mailbox_id and user_id=p_user_id;
  return true;
end;
$$;

create or replace function public.energy_get_mailbox_secrets(p_mailbox_id uuid,p_user_id uuid)
returns table(smtp_password text,imap_password text)
language sql
security definer
set search_path = public,vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where id=m.smtp_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id=m.imap_secret_id)
  from public.energy_mailboxes m where m.id=p_mailbox_id and m.user_id=p_user_id limit 1;
$$;

create or replace function public.energy_get_system_secret(p_name text)
returns text
language sql
security definer
set search_path = public,vault
as $$ select decrypted_secret from vault.decrypted_secrets where name=p_name limit 1 $$;

revoke all on function public.energy_store_mailbox_secrets(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.energy_get_mailbox_secrets(uuid,uuid) from public,anon,authenticated;
revoke all on function public.energy_get_system_secret(text) from public,anon,authenticated;
grant execute on function public.energy_store_mailbox_secrets(uuid,uuid,text,text) to service_role;
grant execute on function public.energy_get_mailbox_secrets(uuid,uuid) to service_role;
grant execute on function public.energy_get_system_secret(text) to service_role;
