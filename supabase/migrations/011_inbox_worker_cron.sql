do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='walkenhorst-inbox-worker' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'walkenhorst-inbox-worker',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/inbox-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='energy_worker_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);
