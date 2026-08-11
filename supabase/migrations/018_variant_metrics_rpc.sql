create or replace function public.energy_increment_variant_metric(
  p_variant_id uuid,
  p_metric text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_metric='sent' then
    update public.energy_campaign_variants set sent_count=sent_count+1,updated_at=now() where id=p_variant_id;
  elsif p_metric='replied' then
    update public.energy_campaign_variants set replied_count=replied_count+1,updated_at=now() where id=p_variant_id;
  elsif p_metric='meeting' then
    update public.energy_campaign_variants set meeting_count=meeting_count+1,updated_at=now() where id=p_variant_id;
  else
    raise exception 'Unknown metric';
  end if;
end;
$$;
revoke all on function public.energy_increment_variant_metric(uuid,text) from public,anon,authenticated;
grant execute on function public.energy_increment_variant_metric(uuid,text) to service_role;
