drop policy if exists energy_lead_contacts_workspace_read on public.energy_lead_contacts;
create policy energy_lead_contacts_workspace_read
on public.energy_lead_contacts
for select
to authenticated
using (energy_has_workspace_access(user_id));

drop policy if exists energy_render_jobs_select_own on public.energy_render_jobs;
drop policy if exists energy_render_jobs_update_own on public.energy_render_jobs;
drop policy if exists energy_render_jobs_delete_own on public.energy_render_jobs;
