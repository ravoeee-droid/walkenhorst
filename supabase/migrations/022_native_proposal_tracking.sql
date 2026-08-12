alter table public.energy_documents
  add column if not exists tracking_token uuid not null default gen_random_uuid();

create unique index if not exists energy_documents_tracking_token_idx
  on public.energy_documents(tracking_token);
