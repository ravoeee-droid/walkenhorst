alter table public.energy_leads
  add column if not exists customer_type text not null default 'commercial';

alter table public.energy_leads
  drop constraint if exists energy_leads_customer_type_check;

alter table public.energy_leads
  add constraint energy_leads_customer_type_check
  check (customer_type in ('commercial', 'private'));

update public.energy_leads
set customer_type = 'commercial'
where customer_type is null
   or customer_type not in ('commercial', 'private');

create index if not exists energy_leads_user_customer_type_updated_idx
  on public.energy_leads (user_id, customer_type, updated_at desc);

create index if not exists energy_leads_user_customer_type_score_idx
  on public.energy_leads (user_id, customer_type, total_score desc);
