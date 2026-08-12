revoke all on function public.energy_track_email_event(uuid,text,text,text) from anon,authenticated;
revoke all on function public.energy_unsubscribe(uuid) from anon,authenticated;
grant execute on function public.energy_track_email_event(uuid,text,text,text) to service_role;
grant execute on function public.energy_unsubscribe(uuid) to service_role;

-- Internal worker key used only for scheduled backend invocations.
do $$
begin
  if not exists(select 1 from vault.secrets where name='energy_worker_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'energy_worker_key','Walkenhorst outbound worker authentication');
  end if;
end $$;
