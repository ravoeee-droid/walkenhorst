alter table public.energy_video_events
  add column if not exists session_id text;

create unique index if not exists energy_video_events_session_dedupe_idx
  on public.energy_video_events(video_page_id, session_id, event_type, coalesce(watch_percent,-1))
  where session_id is not null;

create table if not exists public.energy_qualifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.energy_leads(id) on delete cascade,
  video_page_id uuid references public.energy_video_pages(id) on delete set null,
  session_id text,
  interest text not null,
  timeline text,
  contact_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.energy_qualifications enable row level security;
drop policy if exists "qualifications owner" on public.energy_qualifications;
create policy "qualifications owner" on public.energy_qualifications for select to authenticated using ((select auth.uid())=user_id);
grant select on public.energy_qualifications to authenticated;
create index if not exists energy_qualifications_lead_idx on public.energy_qualifications(lead_id,created_at desc);

create or replace function public.energy_video_to_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_lead uuid;
  v_weight integer := 0;
  v_event text;
begin
  select user_id, lead_id into v_user, v_lead
  from public.energy_video_pages where id=new.video_page_id;
  if v_user is null or v_lead is null then return new; end if;

  if new.event_type='view' then v_weight:=3; v_event:='video_view';
  elsif new.event_type='play' then v_weight:=8; v_event:='video_play';
  elsif new.event_type='cta_click' then v_weight:=35; v_event:='video_cta_click';
  elsif new.event_type='progress' then
    if coalesce(new.watch_percent,0)>=100 then v_weight:=30; v_event:='video_100';
    elsif coalesce(new.watch_percent,0)>=90 then v_weight:=25; v_event:='video_90';
    elsif coalesce(new.watch_percent,0)>=75 then v_weight:=15; v_event:='video_75';
    elsif coalesce(new.watch_percent,0)>=50 then v_weight:=8; v_event:='video_50';
    elsif coalesce(new.watch_percent,0)>=25 then v_weight:=4; v_event:='video_25';
    end if;
  end if;

  if v_weight > 0 then
    insert into public.energy_intent_events(user_id,lead_id,source,event_type,weight,external_id,session_id,metadata)
    values(v_user,v_lead,'video',v_event,v_weight,
      case when new.session_id is null then null else concat('video:',new.video_page_id,':',new.session_id,':',v_event) end,
      new.session_id,jsonb_build_object('video_page_id',new.video_page_id,'watch_percent',new.watch_percent))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists energy_video_intent_trigger on public.energy_video_events;
create trigger energy_video_intent_trigger
after insert on public.energy_video_events
for each row execute function public.energy_video_to_intent();
