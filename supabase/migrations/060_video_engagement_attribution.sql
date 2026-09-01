alter table public.energy_video_events
  add column if not exists playback_seconds integer,
  add column if not exists watch_seconds integer,
  add column if not exists message_tracking_token uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists user_agent text,
  add column if not exists referrer text;

alter table public.energy_video_events
  drop constraint if exists energy_video_events_playback_seconds_check,
  add constraint energy_video_events_playback_seconds_check check (playback_seconds is null or playback_seconds between 0 and 86400),
  drop constraint if exists energy_video_events_watch_seconds_check,
  add constraint energy_video_events_watch_seconds_check check (watch_seconds is null or watch_seconds between 0 and 86400);

create index if not exists energy_video_events_page_session_created_idx
  on public.energy_video_events(video_page_id, session_id, created_at desc);
create index if not exists energy_video_events_message_token_idx
  on public.energy_video_events(message_tracking_token, created_at desc)
  where message_tracking_token is not null;

create or replace view public.energy_video_funnel_v
with (security_invoker = true)
as
with raw_events as (
  select
    e.video_page_id,
    count(*) filter (where e.event_type = 'session_view') as attributed_views,
    count(*) filter (where e.event_type = 'view') as legacy_views,
    count(*) filter (where e.event_type = 'playback_start') as attributed_starts,
    count(*) filter (where e.event_type = 'play') as legacy_starts,
    count(*) filter (where e.event_type = 'cta_attributed') as attributed_ctas,
    count(*) filter (where e.event_type = 'cta_click' or e.event_type like 'cta_%') as legacy_ctas,
    max(coalesce(e.watch_percent,0)) as max_watch_percent,
    max(coalesce(e.playback_seconds,0)) as max_playback_seconds,
    max(coalesce(e.watch_seconds,0)) as max_watch_seconds,
    max(e.created_at) as last_video_event_at
  from public.energy_video_events e
  group by e.video_page_id
), event_agg as (
  select
    video_page_id,
    case when attributed_views > 0 then attributed_views else legacy_views end as page_views,
    case when attributed_starts > 0 then attributed_starts else legacy_starts end as video_starts,
    max_watch_percent,
    max_playback_seconds,
    max_watch_seconds,
    case when attributed_ctas > 0 then attributed_ctas else legacy_ctas end as cta_clicks,
    last_video_event_at
  from raw_events
), message_agg as (
  select
    cm.video_page_id,
    max(m.sent_at) as email_sent_at,
    max(m.opened_at) as email_opened_at,
    max(m.clicked_at) as email_clicked_at,
    max(m.replied_at) as email_replied_at,
    count(*) filter (where m.sent_at is not null) as emails_sent,
    count(*) filter (where m.opened_at is not null) as emails_opened,
    count(*) filter (where m.clicked_at is not null) as emails_clicked
  from public.energy_campaign_members cm
  join public.energy_messages m on m.campaign_member_id = cm.id
  where cm.video_page_id is not null
  group by cm.video_page_id
)
select
  p.user_id,
  p.id as video_page_id,
  p.lead_id,
  l.company_name,
  l.contact_name,
  l.email,
  p.slug,
  p.template_key,
  coalesce(ma.emails_sent,0) as emails_sent,
  coalesce(ma.emails_opened,0) as emails_opened,
  coalesce(ma.emails_clicked,0) as emails_clicked,
  ma.email_sent_at,
  ma.email_opened_at,
  ma.email_clicked_at,
  ma.email_replied_at,
  coalesce(ea.page_views,0) as page_views,
  coalesce(ea.video_starts,0) as video_starts,
  coalesce(ea.max_watch_percent,0) as max_watch_percent,
  coalesce(ea.max_playback_seconds,0) as max_playback_seconds,
  coalesce(ea.max_watch_seconds,0) as max_watch_seconds,
  coalesce(ea.cta_clicks,0) as cta_clicks,
  ea.last_video_event_at
from public.energy_video_pages p
join public.energy_leads l on l.id = p.lead_id
left join event_agg ea on ea.video_page_id = p.id
left join message_agg ma on ma.video_page_id = p.id
where p.is_public = true;

grant select on public.energy_video_funnel_v to authenticated;
