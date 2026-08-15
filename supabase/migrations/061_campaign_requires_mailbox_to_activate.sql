do $$ begin
  alter table public.energy_campaigns add constraint energy_campaigns_active_requires_mailbox_check
  check (status <> 'active' or coalesce(cardinality(mailbox_ids),0) > 0);
exception when duplicate_object then null; end $$;
