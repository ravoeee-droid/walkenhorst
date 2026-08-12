create index if not exists energy_studio_configs_lead_id_idx
  on public.energy_studio_configs(lead_id)
  where lead_id is not null;
