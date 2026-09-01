alter table public.energy_render_jobs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 4,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

alter table public.energy_render_jobs
  drop constraint if exists energy_render_jobs_attempt_count_check;
alter table public.energy_render_jobs
  add constraint energy_render_jobs_attempt_count_check check (attempt_count >= 0 and attempt_count <= 20);
alter table public.energy_render_jobs
  drop constraint if exists energy_render_jobs_max_attempts_check;
alter table public.energy_render_jobs
  add constraint energy_render_jobs_max_attempts_check check (max_attempts >= 1 and max_attempts <= 20);

create index if not exists energy_render_jobs_worker_queue_idx
  on public.energy_render_jobs (status, next_attempt_at, created_at)
  where status = 'queued';

create or replace function public.energy_claim_render_job(p_worker text)
returns setof public.energy_render_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select j.id into v_id
  from public.energy_render_jobs j
  where j.status = 'queued'
    and j.next_attempt_at <= now()
    and j.lead_id is not null
    and j.video_page_id is not null
  order by j.next_attempt_at asc, j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  return query
  update public.energy_render_jobs j
  set status = 'preparing',
      progress = greatest(j.progress, 1),
      attempt_count = j.attempt_count + 1,
      locked_at = now(),
      locked_by = left(coalesce(nullif(trim(p_worker), ''), 'github-actions'), 120),
      started_at = coalesce(j.started_at, now()),
      completed_at = null,
      error = null,
      render_engine = 'github-actions-headless-mp4',
      updated_at = now()
  where j.id = v_id
  returning j.*;
end;
$$;

revoke all on function public.energy_claim_render_job(text) from public, anon, authenticated;
grant execute on function public.energy_claim_render_job(text) to service_role;

create or replace function public.energy_recover_stale_render_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with recovered as (
    update public.energy_render_jobs j
    set status = case when j.attempt_count < j.max_attempts then 'queued' else 'failed' end,
        progress = case when j.attempt_count < j.max_attempts then 0 else j.progress end,
        next_attempt_at = case when j.attempt_count < j.max_attempts then now() else j.next_attempt_at end,
        error = case
          when j.attempt_count < j.max_attempts then 'Automatisch wiederaufgenommen: Worker-Heartbeat abgelaufen.'
          else coalesce(j.error, 'Render nach mehreren Versuchen dauerhaft fehlgeschlagen.')
        end,
        locked_at = null,
        locked_by = null,
        completed_at = case when j.attempt_count < j.max_attempts then null else now() end,
        updated_at = now()
    where j.render_engine = 'github-actions-headless-mp4'
      and j.status in ('preparing','rendering','encoding','uploading')
      and j.updated_at < now() - interval '20 minutes'
    returning 1
  )
  select count(*) into v_count from recovered;
  return v_count;
end;
$$;

revoke all on function public.energy_recover_stale_render_jobs() from public, anon, authenticated;
grant execute on function public.energy_recover_stale_render_jobs() to service_role;

create or replace function public.energy_reset_capture_verification()
returns trigger
language plpgsql
as $$
begin
  if new.template_key = 'energiekosten'
     and (new.website_capture_url is distinct from old.website_capture_url
          or new.studio_revision is distinct from old.studio_revision) then
    new.website_capture_status := 'pending';
    new.website_capture_verified_at := null;
    new.website_capture_width := null;
    new.website_capture_height := null;
    new.website_capture_error := null;
    new.rendered_video_url := null;
    new.rendered_video_format := null;
    new.rendered_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.energy_enqueue_video_render()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config_id uuid;
  v_width integer;
  v_height integer;
  v_fps integer;
  v_aspect text;
begin
  if new.template_key <> 'energiekosten'
     or new.is_public is not true
     or new.status not in ('ready','sent')
     or new.rendered_video_url is not null then
    return new;
  end if;

  select c.id into v_config_id
  from public.energy_studio_configs c
  where c.user_id = new.user_id
    and c.template_key = new.template_key
    and c.scope = 'lead'
    and c.lead_id = new.lead_id
  order by c.updated_at desc
  limit 1;

  if v_config_id is null then
    select c.id into v_config_id
    from public.energy_studio_configs c
    where c.user_id = new.user_id
      and c.template_key = new.template_key
      and c.scope = 'global'
      and c.lead_id is null
    order by c.updated_at desc
    limit 1;
  end if;

  if v_config_id is null then
    raise exception 'Render-Konfiguration für % fehlt', new.template_key;
  end if;

  v_width := greatest(320, least(1920, coalesce(nullif(new.timeline_v3->>'width','')::integer, 1920)));
  v_height := greatest(320, least(1080, coalesce(nullif(new.timeline_v3->>'height','')::integer, 1080)));
  v_fps := greatest(15, least(30, coalesce(nullif(new.timeline_v3->>'fps','')::integer, 25)));
  v_aspect := coalesce(nullif(new.timeline_v3->>'aspectRatio',''), '16:9');
  if v_aspect not in ('16:9','9:16','1:1','4:5') then v_aspect := '16:9'; end if;

  insert into public.energy_render_jobs(
    user_id, studio_config_id, lead_id, video_page_id, format, aspect_ratio,
    width, height, fps, status, progress, render_engine, metadata,
    attempt_count, max_attempts, next_attempt_at
  ) values (
    new.user_id, v_config_id, new.lead_id, new.id, 'mp4', v_aspect,
    v_width, v_height, v_fps, 'queued', 0, 'github-actions-headless-mp4',
    jsonb_build_object(
      'source','automatic_page_trigger',
      'template_key',new.template_key,
      'slug',new.slug,
      'studio_revision',new.studio_revision,
      'render_mode','final_mp4_only',
      'queued_at',now()
    ),
    0, 4, now()
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.energy_enqueue_video_render() from public, anon, authenticated;

drop trigger if exists energy_video_pages_auto_render on public.energy_video_pages;
create trigger energy_video_pages_auto_render
after insert or update of is_public, status, rendered_video_url, website_capture_url, studio_revision, template_key, timeline_v3
on public.energy_video_pages
for each row
execute function public.energy_enqueue_video_render();

update public.energy_render_jobs j
set status='queued',
    progress=0,
    render_engine='github-actions-headless-mp4',
    next_attempt_at=now(),
    locked_at=null,
    locked_by=null,
    completed_at=null,
    error=case when j.error is null then null else left('Vorheriger Versuch: ' || j.error,700) end,
    updated_at=now()
from public.energy_video_pages p
where p.id=j.video_page_id
  and p.template_key='energiekosten'
  and p.is_public=true
  and p.status in ('ready','sent')
  and p.rendered_video_url is null
  and j.status in ('preparing','rendering','encoding','uploading');

insert into public.energy_render_jobs(
  user_id, studio_config_id, lead_id, video_page_id, format, aspect_ratio,
  width, height, fps, status, progress, render_engine, metadata,
  attempt_count, max_attempts, next_attempt_at
)
select
  p.user_id,
  cfg.id,
  p.lead_id,
  p.id,
  'mp4',
  case when coalesce(nullif(p.timeline_v3->>'aspectRatio',''),'16:9') in ('16:9','9:16','1:1','4:5') then coalesce(nullif(p.timeline_v3->>'aspectRatio',''),'16:9') else '16:9' end,
  greatest(320,least(1920,coalesce(nullif(p.timeline_v3->>'width','')::integer,1920))),
  greatest(320,least(1080,coalesce(nullif(p.timeline_v3->>'height','')::integer,1080))),
  greatest(15,least(30,coalesce(nullif(p.timeline_v3->>'fps','')::integer,25))),
  'queued',0,'github-actions-headless-mp4',
  jsonb_build_object('source','automatic_backfill','template_key',p.template_key,'slug',p.slug,'studio_revision',p.studio_revision,'render_mode','final_mp4_only','queued_at',now()),
  0,4,now()
from public.energy_video_pages p
join lateral (
  select c.id
  from public.energy_studio_configs c
  where c.user_id=p.user_id
    and c.template_key=p.template_key
    and ((c.scope='lead' and c.lead_id=p.lead_id) or (c.scope='global' and c.lead_id is null))
  order by case when c.scope='lead' then 0 else 1 end, c.updated_at desc
  limit 1
) cfg on true
where p.template_key='energiekosten'
  and p.is_public=true
  and p.status in ('ready','sent')
  and p.rendered_video_url is null
  and not exists (
    select 1 from public.energy_render_jobs a
    where a.user_id=p.user_id and a.lead_id=p.lead_id
      and a.status in ('queued','preparing','rendering','encoding','uploading')
  )
on conflict do nothing;
