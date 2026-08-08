-- Helpers for Maps-style sync_to_supabase on Property PM Finder.
-- Applied to google-maps-scraper-leads (kemvxzhcxvynmoutwdrh).

CREATE OR REPLACE FUNCTION public.fetch_pmf_contacts(
  p_secret text,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'property_pm_finder'
AS $function$
declare
  expected text;
  contact_rows jsonb;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
  into contact_rows
  from property_pm_finder.contacts c
  where c.run_id = p_run_id;

  return jsonb_build_object('ok', true, 'contacts', contact_rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_scrape_leads(
  p_secret text,
  p_job_id text,
  p_tags text[],
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  expected text;
  deleted_count integer := 0;
  inserted_count integer := 0;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  delete from public.scrape_leads where job_id = p_job_id;
  get diagnostics deleted_count = row_count;

  insert into public.scrape_leads (
    job_id, tags, place_id, name, owner_name, email, phone, website,
    city, state, zip, rating, reviews, category, maps_url, in_icp, raw
  )
  select
    p_job_id,
    coalesce(p_tags, '{}'),
    nullif(row->>'place_id', ''),
    nullif(row->>'name', ''),
    nullif(row->>'owner_name', ''),
    nullif(row->>'email', ''),
    nullif(row->>'phone', ''),
    nullif(row->>'website', ''),
    nullif(row->>'city', ''),
    nullif(row->>'state', ''),
    nullif(row->>'zip', ''),
    nullif(row->>'rating', '')::numeric,
    nullif(row->>'reviews', '')::integer,
    coalesce(nullif(row->>'main_category', ''), nullif(row->>'category', '')),
    nullif(row->>'maps_url', ''),
    case
      when lower(coalesce(row->>'in_icp', '')) in ('true', 't', '1', 'yes') then true
      when lower(coalesce(row->>'in_icp', '')) in ('false', 'f', '0', 'no') then false
      else null
    end,
    row
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row;

  get diagnostics inserted_count = row_count;
  return jsonb_build_object(
    'ok', true,
    'deleted', deleted_count,
    'inserted', inserted_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.count_pmf_sync(
  p_secret text,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'property_pm_finder'
AS $function$
declare
  expected text;
  scrape_job_id text := 'pmf-' || p_run_id::text;
  n_props integer;
  n_contacts integer;
  n_leads integer;
  by_source jsonb;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  select count(*)::int into n_props
  from property_pm_finder.properties where run_id = p_run_id;

  select count(*)::int into n_contacts
  from property_pm_finder.contacts where run_id = p_run_id;

  select count(*)::int into n_leads
  from public.scrape_leads where job_id = scrape_job_id;

  select coalesce(jsonb_object_agg(source, n), '{}'::jsonb)
  into by_source
  from (
    select source, count(*)::int as n
    from property_pm_finder.contacts
    where run_id = p_run_id
    group by source
  ) s;

  return jsonb_build_object(
    'ok', true,
    'run_id', p_run_id,
    'scrape_job_id', scrape_job_id,
    'properties', n_props,
    'contacts', n_contacts,
    'scrape_leads', n_leads,
    'contacts_by_source', by_source
  );
end;
$function$;
