create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='walkenhorst-bounce-worker' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'walkenhorst-bounce-worker',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/bounce-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='energy_worker_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
