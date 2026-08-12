create index if not exists energy_activities_campaign_idx on public.energy_activities(campaign_id) where campaign_id is not null;
create index if not exists energy_followups_campaign_idx on public.energy_followups(campaign_id) where campaign_id is not null;
create index if not exists energy_followups_lead_idx on public.energy_followups(lead_id);
