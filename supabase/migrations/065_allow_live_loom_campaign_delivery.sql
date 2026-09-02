create or replace function public.energy_campaign_video_readiness(p_campaign_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with campaign as (
  select id, user_id, include_video,
         coalesce(nullif(lead_filter->>'studio_template_key',''),'energiekosten') as template_key
  from public.energy_campaigns
  where id = p_campaign_id
), video_required as (
  select c.*,
         (coalesce(c.include_video,false) or exists (
            select 1 from public.energy_campaign_steps s
            where s.campaign_id=c.id and s.active=true
              and (coalesce(s.include_video,false) or s.step_type='video_email')
         )) as needs_video
  from campaign c
), rows as (
  select cm.lead_id,
         vr.template_key,
         cfg.id as studio_config_id,
         cfg.autosave_revision as current_revision,
         cfg.published_revision,
         vp.id as video_page_id,
         vp.rendered_video_url,
         vp.rendered_video_format,
         vp.rendered_at,
         vp.studio_revision,
         vp.timeline_v3,
         vp.website_capture_url,
         vp.presenter_video_url,
         case when cfg.id is not null
                    and coalesce(cfg.published_revision,-1)=coalesce(cfg.autosave_revision,-2)
                    and vp.id is not null
                    and vp.template_key=vr.template_key
                    and coalesce(vp.studio_revision,-1)=coalesce(cfg.autosave_revision,-2)
                    and nullif(vp.rendered_video_url,'') is not null
                    and lower(coalesce(vp.rendered_video_format,''))='mp4'
                    and vp.rendered_at is not null
              then true else false end as mp4_ready,
         case when cfg.id is not null
                    and coalesce(cfg.published_revision,-1)=coalesce(cfg.autosave_revision,-2)
                    and vp.id is not null
                    and vp.template_key=vr.template_key
                    and coalesce(vp.studio_revision,-1)=coalesce(cfg.autosave_revision,-2)
                    and jsonb_typeof(vp.timeline_v3)='object'
                    and vp.timeline_v3->>'version'='3'
                    and jsonb_typeof(vp.timeline_v3->'tracks')='array'
                    and jsonb_array_length(vp.timeline_v3->'tracks')>0
                    and nullif(vp.website_capture_url,'') is not null
                    and nullif(vp.presenter_video_url,'') is not null
              then true else false end as live_ready
  from video_required vr
  join public.energy_campaign_members cm on cm.campaign_id=vr.id and cm.status='queued'
  left join lateral (
    select sc.id, sc.autosave_revision, sc.published_revision
    from public.energy_studio_configs sc
    where sc.user_id=vr.user_id
      and sc.template_key=vr.template_key
      and sc.scope='global' and sc.lead_id is null
    order by sc.updated_at desc
    limit 1
  ) cfg on true
  left join lateral (
    select p.id,p.template_key,p.rendered_video_url,p.rendered_video_format,p.rendered_at,
           p.studio_revision,p.timeline_v3,p.website_capture_url,p.presenter_video_url
    from public.energy_video_pages p
    where p.user_id=vr.user_id and p.lead_id=cm.lead_id and p.template_key=vr.template_key
      and p.status in ('ready','sent')
    order by p.updated_at desc
    limit 1
  ) vp on true
  where vr.needs_video
)
select jsonb_build_object(
  'required', count(*),
  'ready', count(*) filter (where live_ready or mp4_ready),
  'liveReady', count(*) filter (where live_ready),
  'mp4Ready', count(*) filter (where mp4_ready),
  'pending', count(*) filter (where not (live_ready or mp4_ready)),
  'templateKey', coalesce(max(template_key),'energiekosten'),
  'missingConfig', count(*) filter (where studio_config_id is null),
  'unpublishedMaster', count(*) filter (where studio_config_id is not null and coalesce(published_revision,-1)<>coalesce(current_revision,-2)),
  'missingPage', count(*) filter (where video_page_id is null),
  'missingOrStaleVideo', count(*) filter (where studio_config_id is not null and video_page_id is not null and not (live_ready or mp4_ready))
)
from rows;
$function$;

create or replace function public.energy_enforce_campaign_video_launch_gate()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  r jsonb;
  required_count integer;
  ready_count integer;
  approval_required boolean;
  manual_approved boolean;
begin
  if new.status='active' then
    approval_required := coalesce((new.lead_filter->>'approval_required')::boolean,false);
    manual_approved := coalesce((new.lead_filter->>'manual_launch_approved')::boolean,false);
    if approval_required and not manual_approved then
      raise exception using
        errcode='check_violation',
        message='MANUAL_LAUNCH_APPROVAL_REQUIRED: Die erste Nachricht wurde noch nicht ausdrücklich freigegeben.';
    end if;

    r := public.energy_campaign_video_readiness(new.id);
    required_count := coalesce((r->>'required')::integer,0);
    ready_count := coalesce((r->>'ready')::integer,0);
    if required_count > ready_count then
      raise exception using
        errcode='check_violation',
        message=format('VIDEO_LAUNCH_BLOCKED: %s/%s personalisierte Loom-Videos bereit (Live-Timeline oder MP4, Master %s). Versand bleibt gesperrt.', ready_count, required_count, coalesce(r->>'templateKey','energiekosten'));
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.energy_enforce_outbound_video_message_gate()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  c record;
  s record;
  cfg record;
  vp record;
  needs_video boolean := false;
  v_template_key text;
  live_ready boolean := false;
  mp4_ready boolean := false;
begin
  if new.direction <> 'outbound' or new.campaign_id is null then
    return new;
  end if;

  select id,user_id,include_video,lead_filter into c
  from public.energy_campaigns where id=new.campaign_id;
  if not found then return new; end if;

  select step_type,include_video into s
  from public.energy_campaign_steps
  where campaign_id=new.campaign_id and step_order=new.step_order and active=true
  limit 1;

  needs_video := coalesce(c.include_video,false)
                 or coalesce(s.include_video,false)
                 or coalesce(s.step_type,'')='video_email';
  if not needs_video then return new; end if;

  v_template_key := coalesce(nullif(c.lead_filter->>'studio_template_key',''),'energiekosten');

  select sc.id,sc.autosave_revision,sc.published_revision into cfg
  from public.energy_studio_configs sc
  where sc.user_id=c.user_id and sc.scope='global' and sc.lead_id is null and sc.template_key=v_template_key
  order by sc.updated_at desc limit 1;

  if cfg.id is null or coalesce(cfg.published_revision,-1)<>coalesce(cfg.autosave_revision,-2) then
    raise exception using errcode='check_violation',
      message=format('VIDEO_SEND_BLOCKED: Golden Master %s ist nicht veröffentlicht.',v_template_key);
  end if;

  select p.id,p.rendered_video_url,p.rendered_video_format,p.rendered_at,p.studio_revision,
         p.timeline_v3,p.website_capture_url,p.presenter_video_url into vp
  from public.energy_video_pages p
  where p.user_id=c.user_id and p.lead_id=new.lead_id and p.template_key=v_template_key and p.status in ('ready','sent')
  order by p.updated_at desc limit 1;

  if vp.id is not null and coalesce(vp.studio_revision,-1)=coalesce(cfg.autosave_revision,-2) then
    mp4_ready := nullif(vp.rendered_video_url,'') is not null
                 and lower(coalesce(vp.rendered_video_format,''))='mp4'
                 and vp.rendered_at is not null;
    live_ready := jsonb_typeof(vp.timeline_v3)='object'
                  and vp.timeline_v3->>'version'='3'
                  and jsonb_typeof(vp.timeline_v3->'tracks')='array'
                  and jsonb_array_length(vp.timeline_v3->'tracks')>0
                  and nullif(vp.website_capture_url,'') is not null
                  and nullif(vp.presenter_video_url,'') is not null;
  end if;

  if not (live_ready or mp4_ready) then
    raise exception using errcode='check_violation',
      message=format('VIDEO_SEND_BLOCKED: Für Lead %s fehlt das aktuelle personalisierte Loom-Video (Live-Timeline oder MP4, Master %s Rev %s).',new.lead_id,v_template_key,cfg.autosave_revision);
  end if;

  return new;
end;
$function$;
