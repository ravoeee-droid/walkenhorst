create index if not exists energy_brand_kits_logo_asset_idx
  on public.energy_brand_kits(logo_asset_id)
  where logo_asset_id is not null;

create index if not exists energy_brand_kits_portrait_asset_idx
  on public.energy_brand_kits(portrait_asset_id)
  where portrait_asset_id is not null;
