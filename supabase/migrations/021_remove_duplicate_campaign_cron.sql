do $$
declare duplicate_job bigint;
begin
  select jobid into duplicate_job from cron.job where jobname='walkenhorst-campaign-worker' limit 1;
  if duplicate_job is not null then perform cron.unschedule(duplicate_job); end if;
end $$;
