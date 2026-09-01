create or replace function public.energy_claim_render_job(p_worker text)
returns setof public.energy_render_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select j.id
    into v_id
  from public.energy_render_jobs j
  where j.status = 'queued'
    and j.next_attempt_at <= now()
    and j.lead_id is not null
    and j.video_page_id is not null
    and j.render_engine = 'github-actions-headless-mp4'
    and exists (
      select 1
      from public.energy_video_pages p
      where p.id = j.video_page_id
        and p.user_id = j.user_id
        and p.template_key = 'energiekosten'
        and p.is_public = true
        and p.status in ('ready','sent')
        and p.rendered_video_url is null
    )
  order by j.next_attempt_at asc, j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.energy_render_jobs j
  set status = 'preparing',
      progress = greatest(j.progress, 1),
      attempt_count = j.attempt_count + 1,
      locked_at = now(),
      locked_by = left(coalesce(nullif(trim(p_worker), ''), 'github-actions'), 120),
      started_at = coalesce(j.started_at, now()),
      completed_at = null,
      error = null,
      render_engine = 'github-actions-headless-mp4',
      updated_at = now()
  where j.id = v_id
  returning j.*;
end;
$$;

revoke all on function public.energy_claim_render_job(text) from public, anon, authenticated;
grant execute on function public.energy_claim_render_job(text) to service_role;
