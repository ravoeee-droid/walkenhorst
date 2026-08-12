create table if not exists public.energy_webhook_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  token_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique(user_id, provider)
);

create table if not exists public.energy_automation_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.energy_leads(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.energy_webhook_tokens enable row level security;
alter table public.energy_automation_outbox enable row level security;

drop policy if exists "webhook tokens owner" on public.energy_webhook_tokens;
create policy "webhook tokens owner" on public.energy_webhook_tokens for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "automation outbox owner" on public.energy_automation_outbox;
create policy "automation outbox owner" on public.energy_automation_outbox for select to authenticated using ((select auth.uid())=user_id);

grant select on public.energy_webhook_tokens to authenticated;
grant select on public.energy_automation_outbox to authenticated;

create index if not exists energy_automation_outbox_queue_idx on public.energy_automation_outbox(status,next_attempt_at);
create index if not exists energy_automation_outbox_user_idx on public.energy_automation_outbox(user_id,created_at desc);

create or replace function public.energy_queue_automation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.weight >= 10 then
    insert into public.energy_automation_outbox(user_id,lead_id,event_type,payload)
    values(new.user_id,new.lead_id,new.event_type,jsonb_build_object(
      'source',new.source,
      'weight',new.weight,
      'intent_event_id',new.id,
      'metadata',new.metadata,
      'occurred_at',new.occurred_at
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists energy_intent_automation_trigger on public.energy_intent_events;
create trigger energy_intent_automation_trigger
after insert on public.energy_intent_events
for each row execute function public.energy_queue_automation_event();
