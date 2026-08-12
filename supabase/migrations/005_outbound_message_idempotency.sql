alter table public.energy_messages add column if not exists step_order smallint;
create unique index if not exists energy_messages_member_step_unique on public.energy_messages(campaign_member_id,step_order) where campaign_member_id is not null and step_order is not null and direction='outbound';
