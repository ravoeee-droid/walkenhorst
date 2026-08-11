create table if not exists public.energy_lead_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  location text,
  industry text,
  radius_km integer not null default 25 check (radius_km between 1 and 200),
  result_count integer not null default 0,
  status text not null default 'running' check (status in ('running','completed','failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.energy_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  role text,
  email text,
  phone text,
  linkedin_url text,
  is_primary boolean not null default false,
  email_status text not null default 'unknown' check (email_status in ('unknown','valid','risky','invalid')),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_activities (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete set null,
  type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.energy_sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.energy_sequences(id) on delete cascade,
  step_order integer not null check (step_order >= 1),
  delay_days integer not null default 0 check (delay_days between 0 and 90),
  channel text not null default 'email' check (channel in ('email','call','video','task')),
  subject_template text,
  body_template text,
  create_video boolean not null default false,
  stop_on_reply boolean not null default true,
  created_at timestamptz not null default now(),
  unique(sequence_id, step_order)
);

alter table public.energy_mailboxes
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer,
  add column if not exists smtp_secure boolean not null default true,
  add column if not exists smtp_username text,
  add column if not exists reply_to text,
  add column if not exists last_test_at timestamptz,
  add column if not exists last_error text,
  add column if not exists sent_today integer not null default 0,
  add column if not exists sent_date date;

create table if not exists public.energy_mailbox_secrets (
  mailbox_id uuid primary key references public.energy_mailboxes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  smtp_password text not null,
  updated_at timestamptz not null default now()
);

alter table public.energy_mailbox_secrets enable row level security;
revoke all on public.energy_mailbox_secrets from anon, authenticated;

alter table public.energy_campaigns
  add column if not exists sequence_id uuid references public.energy_sequences(id) on delete set null,
  add column if not exists mailbox_ids uuid[] not null default '{}'::uuid[],
  add column if not exists timezone text not null default 'Europe/Berlin',
  add column if not exists send_window_start time not null default '08:30',
  add column if not exists send_window_end time not null default '16:30',
  add column if not exists weekdays smallint[] not null default '{1,2,3,4,5}'::smallint[],
  add column if not exists stop_on_reply boolean not null default true,
  add column if not exists track_clicks boolean not null default true,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.energy_campaign_members
  add column if not exists current_step integer not null default 1,
  add column if not exists next_send_at timestamptz,
  add column if not exists personalized_subject text,
  add column if not exists personalized_body text,
  add column if not exists last_message_id text,
  add column if not exists replied_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;

create table if not exists public.energy_email_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete cascade,
  member_id uuid references public.energy_campaign_members(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  mailbox_id uuid not null references public.energy_mailboxes(id) on delete cascade,
  step_order integer not null default 1,
  to_email text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  scheduled_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled','bounced','replied')),
  attempts integer not null default 0,
  message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.energy_email_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.energy_email_jobs(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('queued','sent','delivered','clicked','replied','bounced','failed','unsubscribed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.energy_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  campaign_id uuid references public.energy_campaigns(id) on delete set null,
  mailbox_id uuid references public.energy_mailboxes(id) on delete set null,
  external_message_id text,
  from_email text not null,
  subject text,
  body_text text,
  classification text not null default 'unclassified' check (classification in ('unclassified','interested','not_interested','later','out_of_office','wrong_person','meeting','unsubscribe')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists energy_contacts_lead_idx on public.energy_contacts(lead_id);
create index if not exists energy_contacts_user_email_idx on public.energy_contacts(user_id,email);
create index if not exists energy_activities_lead_created_idx on public.energy_activities(lead_id,created_at desc);
create index if not exists energy_sequence_steps_sequence_idx on public.energy_sequence_steps(sequence_id,step_order);
create index if not exists energy_email_jobs_queue_idx on public.energy_email_jobs(status,scheduled_at);
create index if not exists energy_email_jobs_campaign_idx on public.energy_email_jobs(campaign_id,status);
create index if not exists energy_email_events_lead_idx on public.energy_email_events(lead_id,created_at desc);
create index if not exists energy_replies_user_received_idx on public.energy_replies(user_id,received_at desc);

alter table public.energy_lead_searches enable row level security;
alter table public.energy_contacts enable row level security;
alter table public.energy_activities enable row level security;
alter table public.energy_sequences enable row level security;
alter table public.energy_sequence_steps enable row level security;
alter table public.energy_email_jobs enable row level security;
alter table public.energy_email_events enable row level security;
alter table public.energy_replies enable row level security;

create policy "lead searches owner" on public.energy_lead_searches for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "contacts owner" on public.energy_contacts for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "activities owner" on public.energy_activities for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "sequences owner" on public.energy_sequences for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "sequence steps owner" on public.energy_sequence_steps for all to authenticated using (exists(select 1 from public.energy_sequences s where s.id=sequence_id and s.user_id=(select auth.uid()))) with check (exists(select 1 from public.energy_sequences s where s.id=sequence_id and s.user_id=(select auth.uid())));
create policy "email jobs owner" on public.energy_email_jobs for select to authenticated using ((select auth.uid())=user_id);
create policy "email events owner" on public.energy_email_events for select to authenticated using ((select auth.uid())=user_id);
create policy "replies owner" on public.energy_replies for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

grant select,insert,update,delete on public.energy_lead_searches to authenticated;
grant select,insert,update,delete on public.energy_contacts to authenticated;
grant select,insert,update,delete on public.energy_activities to authenticated;
grant select,insert,update,delete on public.energy_sequences to authenticated;
grant select,insert,update,delete on public.energy_sequence_steps to authenticated;
grant select on public.energy_email_jobs to authenticated;
grant select on public.energy_email_events to authenticated;
grant select,insert,update,delete on public.energy_replies to authenticated;
