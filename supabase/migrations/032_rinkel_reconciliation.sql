alter table public.energy_calls add column if not exists cdr_synced_at timestamptz;
alter table public.energy_calls add column if not exists transcript_raw text;
alter table public.energy_calls add column if not exists transcript_synced_at timestamptz;
alter table public.energy_calls add column if not exists reconciliation_error text;

create index if not exists energy_calls_reconcile_idx
on public.energy_calls(provider,ended_at,cdr_synced_at,transcript_synced_at)
where provider='rinkel' and ended_at is not null;
