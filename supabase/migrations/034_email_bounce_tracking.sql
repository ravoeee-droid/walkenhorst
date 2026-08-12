alter table public.energy_mailboxes add column if not exists last_bounce_sync_at timestamptz;
alter table public.energy_mailboxes add column if not exists last_bounce_error text;

create table if not exists public.energy_bounces (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid not null references public.energy_mailboxes(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete set null,
  message_id uuid references public.energy_messages(id) on delete set null,
  campaign_id uuid references public.energy_campaigns(id) on delete set null,
  campaign_member_id uuid references public.energy_campaign_members(id) on delete set null,
  provider_message_id text not null,
  bounced_email text not null,
  bounce_type text not null default 'unknown' check (bounce_type in ('hard','soft','unknown')),
  diagnostic text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(mailbox_id,provider_message_id)
);

create index if not exists energy_bounces_user_created_idx on public.energy_bounces(user_id,created_at desc);
create index if not exists energy_bounces_lead_idx on public.energy_bounces(lead_id,created_at desc);
create index if not exists energy_bounces_email_idx on public.energy_bounces(user_id,lower(bounced_email));

alter table public.energy_bounces enable row level security;
drop policy if exists "bounce owner access" on public.energy_bounces;
create policy "bounce owner access" on public.energy_bounces
for all to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);
