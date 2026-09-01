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
  end if;
  return new;
end;
$$;

drop trigger if exists energy_video_pages_reset_capture_verification on public.energy_video_pages;
create trigger energy_video_pages_reset_capture_verification
before update of website_capture_url, studio_revision on public.energy_video_pages
for each row
execute function public.energy_reset_capture_verification();
