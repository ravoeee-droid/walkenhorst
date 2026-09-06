alter view public.energy_crm_lead_workflow set (security_invoker = true);

alter function public.energy_reset_capture_verification() set search_path = public;

revoke execute on function public.energy_check_lead_pool_health() from public, anon, authenticated;
revoke execute on function public.energy_enforce_energiekosten_timeline() from public, anon, authenticated;
revoke execute on function public.energy_rev93_launch_gate() from public, anon, authenticated;
revoke execute on function public.energy_rev93_replace_bad_leads() from public, anon, authenticated;
revoke execute on function public.energy_sync_global_landing_to_video_pages() from public, anon, authenticated;
revoke execute on function public.energy_validate_video_attribution() from public, anon, authenticated;

grant execute on function public.energy_check_lead_pool_health() to service_role;
grant execute on function public.energy_enforce_energiekosten_timeline() to service_role;
grant execute on function public.energy_rev93_launch_gate() to service_role;
grant execute on function public.energy_rev93_replace_bad_leads() to service_role;
grant execute on function public.energy_sync_global_landing_to_video_pages() to service_role;
grant execute on function public.energy_validate_video_attribution() to service_role;
