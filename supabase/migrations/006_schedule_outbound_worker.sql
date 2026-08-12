do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='walkenhorst-campaign-worker' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'walkenhorst-campaign-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/campaign-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='energy_worker_key')
      ),
      body := jsonb_build_object('source','cron','limit',10)
    );
  $$
);
