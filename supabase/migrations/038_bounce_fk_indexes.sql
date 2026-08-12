create index if not exists energy_bounces_message_idx on public.energy_bounces(message_id) where message_id is not null;
create index if not exists energy_bounces_campaign_idx on public.energy_bounces(campaign_id) where campaign_id is not null;
create index if not exists energy_bounces_member_idx on public.energy_bounces(campaign_member_id) where campaign_member_id is not null;
