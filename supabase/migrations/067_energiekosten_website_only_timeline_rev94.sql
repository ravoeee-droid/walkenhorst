-- Walkenhorst Energiekosten Rev 94
-- Personalization stays visible for the complete 107s video.
-- Removes the legacy slide overlay that obscured the company website and
-- reintroduces blur through low-resolution presentation assets.

with master as (
  select
    id,
    config,
    (
      select track
      from jsonb_array_elements(config #> '{timeline,tracks}') track
      where track->>'id' = 'track-bg'
      limit 1
    ) as website_track,
    (
      select track
      from jsonb_array_elements(config #> '{timeline,tracks}') track
      where track->>'id' = 'track-presenter'
      limit 1
    ) as presenter_track
  from public.energy_studio_configs
  where template_key = 'energiekosten'
    and scope = 'global'
    and lead_id is null
  order by updated_at desc
  limit 1
), normalized as (
  select
    id,
    jsonb_set(
      jsonb_set(
        config,
        '{timeline,tracks}',
        jsonb_build_array(
          jsonb_set(
            jsonb_set(
              website_track,
              '{items,0,endMs}',
              '107000'::jsonb,
              true
            ),
            '{items,0,keyframes}',
            '[{"atMs":0,"scale":1,"scrollY":0},{"atMs":12000,"scale":1,"scrollY":10},{"atMs":30000,"scale":1,"scrollY":25},{"atMs":52000,"scale":1,"scrollY":42},{"atMs":76000,"scale":1,"scrollY":58},{"atMs":106900,"scale":1,"scrollY":72}]'::jsonb,
            true
          ),
          presenter_track
        ),
        true
      ),
      '{updatedAt}',
      to_jsonb(now()::text),
      true
    ) as config94
  from master
  where website_track is not null
    and presenter_track is not null
)
update public.energy_studio_configs s
set config = n.config94,
    autosave_revision = 94,
    published_revision = 94,
    last_autosaved_at = now(),
    updated_at = now()
from normalized n
where s.id = n.id;

create or replace function public.energy_build_energiekosten_timeline(
  p_user_id uuid,
  p_capture_url text,
  p_presenter_url text default null::text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_presenter text := nullif(p_presenter_url,'');
begin
  if nullif(p_capture_url,'') is null then
    raise exception 'Personalisierter Website-Capture fehlt';
  end if;

  if v_presenter is null then
    select format(
      'https://jiahshldcusphxtbqxpv.supabase.co/storage/v1/object/public/%s/%s',
      coalesce(a.storage_bucket,'energy-media'),
      a.storage_path
    )
      into v_presenter
    from public.energy_media_assets a
    where a.user_id = p_user_id
      and a.kind = 'video'
      and a.metadata->>'template' = 'energiekosten'
      and a.metadata->>'audience' = 'b2b'
      and coalesce((a.metadata->>'approved')::boolean,true) = true
    order by a.created_at desc
    limit 1;
  end if;

  if v_presenter is null then
    raise exception 'Freigegebener B2B-Presenter fehlt';
  end if;

  return jsonb_build_object(
    'version',3,
    'durationMs',107000,
    'width',1920,
    'height',1080,
    'fps',25,
    'aspectRatio','16:9',
    'tracks', jsonb_build_array(
      jsonb_build_object(
        'id','track-bg',
        'name','Unternehmenswebsite',
        'type','background',
        'zIndex',10,
        'locked',false,
        'hidden',false,
        'color','#0A2740',
        'items',jsonb_build_array(
          jsonb_build_object(
            'id','website-personalized-master',
            'type','website',
            'label','Echte Unternehmenswebsite',
            'trackId','track-bg',
            'startMs',0,
            'endMs',107000,
            'zIndex',10,
            'dynamicSource','website_capture',
            'sourceUrl',p_capture_url,
            'fit','cover',
            'volume',1,
            'playbackRate',1,
            'shadow','none',
            'transition','cut',
            'animationIn','none',
            'animationOut','none',
            'animationDurationMs',0,
            'transform',jsonb_build_object(
              'x',0,'y',0,'width',100,'height',100,'rotation',0,
              'opacity',1,'borderRadius',0,'scale',1
            ),
            'keyframes',jsonb_build_array(
              jsonb_build_object('atMs',0,'scrollY',0,'scale',1),
              jsonb_build_object('atMs',12000,'scrollY',10,'scale',1),
              jsonb_build_object('atMs',30000,'scrollY',25,'scale',1),
              jsonb_build_object('atMs',52000,'scrollY',42,'scale',1),
              jsonb_build_object('atMs',76000,'scrollY',58,'scale',1),
              jsonb_build_object('atMs',106900,'scrollY',72,'scale',1)
            ),
            'metadata',jsonb_build_object(
              'scroll_mode','fullpage',
              'qa_required',true,
              'capture_width',1920,
              'capture_height',1080,
              'revision',94
            )
          )
        )
      ),
      jsonb_build_object(
        'id','track-presenter',
        'name','Andreas / Sprecher',
        'type','presenter',
        'zIndex',70,
        'locked',true,
        'hidden',false,
        'color','#3BC9A6',
        'items',jsonb_build_array(
          jsonb_build_object(
            'id','presenter-b2b-bubble',
            'type','presenter',
            'label','Andreas Walkenhorst · B2B',
            'trackId','track-presenter',
            'startMs',0,
            'endMs',107000,
            'zIndex',72,
            'dynamicSource','presenter',
            'sourceUrl',v_presenter,
            'fit','cover',
            'volume',1,
            'playbackRate',1,
            'shadow','strong',
            'transition','cut',
            'animationIn','fade',
            'animationOut','fade',
            'animationDurationMs',220,
            'metadata',jsonb_build_object(
              'mode','bubble',
              'audience','b2b',
              'approved',true
            ),
            'transform',jsonb_build_object(
              'x',82.5,'y',69,'width',13.5,'height',24,'rotation',0,
              'opacity',1,'borderRadius',999,'scale',1
            )
          )
        )
      )
    )
  );
end;
$function$;

-- Rebuild every public Energiekosten page through the existing BEFORE trigger.
-- Naming timeline_v3 in SET is intentional: the trigger replaces it with the
-- new two-track website + presenter timeline.
update public.energy_video_pages
set timeline_v3 = timeline_v3,
    studio_revision = 94,
    thumbnail_url = case
      when thumbnail_url like '%/api/public/studio-capture/%'
        then replace(thumbnail_url, '/api/public/studio-capture/', '/api/public/studio-poster/')
      else thumbnail_url
    end,
    updated_at = now()
where template_key = 'energiekosten'
  and is_public = true
  and status in ('ready','sent');
