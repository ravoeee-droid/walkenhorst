create or replace function public.energy_normalize_company(p_name text)
returns text
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare v text;
begin
  v:=lower(btrim(coalesce(p_name,'')));
  if v='' then return null; end if;
  v:=regexp_replace(v,'[^a-z0-9äöüß]+','','gi');
  v:=regexp_replace(v,'(gmbhundcokg|gmbhcokg|ughaftungsbeschränkt|gmbh|mbh|gbr|ohg|ag|kg|ug|ek|se)$','','i');
  if length(v)<3 then return null; end if;
  return v;
end;
$$;
