alter table public.energy_messages alter column lead_id drop not null;

create index if not exists energy_messages_user_direction_created_idx
  on public.energy_messages(user_id, direction, created_at desc);

comment on column public.energy_messages.lead_id is
  'Optional for inbound mailbox messages that have not yet been matched to a CRM lead.';
