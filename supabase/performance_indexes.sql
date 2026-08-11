create index if not exists energy_campaign_members_lead_idx
  on public.energy_campaign_members(lead_id);

create index if not exists energy_campaign_members_video_idx
  on public.energy_campaign_members(video_page_id);
