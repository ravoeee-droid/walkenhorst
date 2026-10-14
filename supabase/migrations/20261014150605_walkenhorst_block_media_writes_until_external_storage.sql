-- Walkenhorst recovery guard: preserve Auth/CRM quota by disabling media writes.
-- Existing media can still be read/deleted by the existing workspace policies.
create policy walkenhorst_storage_quota_guard_insert on storage.objects as restrictive for insert to anon, authenticated with check (bucket_id <> 'energy-media');
create policy walkenhorst_storage_quota_guard_update on storage.objects as restrictive for update to anon, authenticated using (bucket_id <> 'energy-media') with check (bucket_id <> 'energy-media');
