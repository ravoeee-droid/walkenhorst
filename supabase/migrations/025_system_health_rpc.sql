create or replace function public.energy_system_health()
returns jsonb
language plpgsql
security definer
set search_path = public, cron, net
as $$
declare
  v_user uuid := auth.uid();
  v_jobs jsonb;
  v_failed_runs integer := 0;
  v_http_errors integer := 0;
  v_http_ok integer := 0;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobname', j.jobname,
    'schedule', j.schedule,
    'active', j.active,
    'last_status', r.status,
    'last_started_at', r.start_time,
    'last_finished_at', r.end_time,
    'last_message', case when r.status is distinct from 'succeeded' then left(coalesce(r.return_message,''), 240) else null end
  ) order by j.jobname), '[]'::jsonb)
  into v_jobs
  from cron.job j
  left join lateral (
    select d.status,d.start_time,d.end_time,d.return_message
    from cron.job_run_details d
    where d.jobid=j.jobid
    order by d.start_time desc
    limit 1
  ) r on true
  where j.jobname like 'walkenhorst-%';

  select count(*) into v_failed_runs
  from cron.job_run_details d
  join cron.job j on j.jobid=d.jobid
  where j.jobname like 'walkenhorst-%'
    and d.start_time >= now()-interval '24 hours'
    and coalesce(d.status,'') <> 'succeeded';

  select
    count(*) filter (where status_code between 200 and 299),
    count(*) filter (where status_code is null or status_code < 200 or status_code >= 300)
  into v_http_ok,v_http_errors
  from net._http_response
  where created >= now()-interval '24 hours';

  return jsonb_build_object(
    'checked_at', now(),
    'jobs', v_jobs,
    'failed_cron_runs_24h', v_failed_runs,
    'http_ok_24h', v_http_ok,
    'http_errors_24h', v_http_errors
  );
end;
$$;

revoke all on function public.energy_system_health() from public, anon;
grant execute on function public.energy_system_health() to authenticated;
