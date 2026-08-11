create index if not exists energy_automation_outbox_lead_idx on public.energy_automation_outbox(lead_id);
create index if not exists energy_campaign_variants_user_idx on public.energy_campaign_variants(user_id);
create index if not exists energy_deals_lead_idx on public.energy_deals(lead_id);
create index if not exists energy_documents_deal_idx on public.energy_documents(deal_id);
create index if not exists energy_documents_user_idx on public.energy_documents(user_id);
create index if not exists energy_qualifications_user_idx on public.energy_qualifications(user_id);
create index if not exists energy_qualifications_video_idx on public.energy_qualifications(video_page_id);
