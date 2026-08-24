-- Owner-cell enrichment for Cayden calling lists + extra Claude-settable API keys.

CREATE TABLE IF NOT EXISTS permit_parcel.contact_enrichment (
  list_id text NOT NULL,
  lead_id bigint NOT NULL,
  place_id text,
  company_name text,
  contact_name text,
  phone text,
  email text,
  owner_score text,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  email_kind text,
  phone_line_type text,
  phone_carrier text,
  officer_name text,
  officer_title text,
  officer_street text,
  officer_city text,
  officer_state text,
  officer_zip text,
  officer_match text,
  taxpayer_id text,
  owner_search_name text,
  people_search jsonb,
  owner_cell text,
  owner_cell_source text,
  dial_status text NOT NULL DEFAULT 'needs_enrichment',
  evidence text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_pp_enrichment_dial ON permit_parcel.contact_enrichment (list_id, dial_status);
ALTER TABLE permit_parcel.contact_enrichment ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fetch_permit_parcel_setting(
  p_secret text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  row_json jsonb;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  if p_key is null or p_key not in ('shovels_api_key', 'veriphone_api_key', 'texas_cpa_api_key') then
    raise exception 'unknown setting';
  end if;

  select jsonb_build_object(
    'ok', true,
    'found', true,
    'key', s.key,
    'value', s.value,
    'updated_by', s.updated_by,
    'updated_at', s.updated_at
  )
  into row_json
  from permit_parcel.app_settings s
  where s.key = p_key;

  if row_json is null then
    return jsonb_build_object('ok', true, 'found', false, 'key', p_key);
  end if;
  return row_json;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_permit_parcel_setting(
  p_secret text,
  p_key text,
  p_value text,
  p_updated_by text DEFAULT 'cayden'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  if p_key is null or p_key not in ('shovels_api_key', 'veriphone_api_key', 'texas_cpa_api_key') then
    raise exception 'unknown setting';
  end if;

  insert into permit_parcel.app_settings (key, value, updated_by, updated_at)
  values (p_key, coalesce(p_value, ''), coalesce(nullif(p_updated_by, ''), 'cayden'), now())
  on conflict (key) do update set
    value = excluded.value,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object('ok', true, 'key', p_key, 'updated_by', coalesce(nullif(p_updated_by, ''), 'cayden'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.fetch_permit_parcel_calling_list_contacts(
  p_secret text,
  p_list_id text,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  rows jsonb;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  if p_list_id is null or p_list_id = '' then
    return jsonb_build_object('ok', false, 'error', 'list_id required', 'rows', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  into rows
  from (
    select
      sl.job_id as list_id,
      sl.id as lead_id,
      sl.place_id,
      sl.name as company_name,
      sl.owner_name as contact_name,
      sl.phone,
      sl.email,
      sl.city,
      sl.state,
      sl.zip,
      e.owner_score,
      e.flags,
      e.email_kind,
      e.phone_line_type,
      e.phone_carrier,
      e.officer_name,
      e.officer_title,
      e.officer_street,
      e.officer_city,
      e.officer_state,
      e.officer_zip,
      e.officer_match,
      e.taxpayer_id,
      e.owner_search_name,
      e.people_search,
      e.owner_cell,
      e.owner_cell_source,
      e.dial_status,
      e.evidence
    from public.scrape_leads sl
    left join permit_parcel.contact_enrichment e
      on e.list_id = sl.job_id and e.lead_id = sl.id
    where sl.job_id = p_list_id
    order by sl.name nulls last, sl.id
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  ) x;

  return jsonb_build_object('ok', true, 'rows', rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_permit_parcel_enrichment(
  p_secret text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  n integer := 0;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  insert into permit_parcel.contact_enrichment (
    list_id, lead_id, place_id, company_name, contact_name, phone, email,
    owner_score, flags, email_kind, phone_line_type, phone_carrier,
    officer_name, officer_title, officer_street, officer_city, officer_state, officer_zip,
    officer_match, taxpayer_id, owner_search_name, people_search,
    owner_cell, owner_cell_source, dial_status, evidence, updated_at
  )
  select
    coalesce(r->>'list_id', ''),
    (r->>'lead_id')::bigint,
    nullif(r->>'place_id', ''),
    r->>'company_name',
    r->>'contact_name',
    r->>'phone',
    r->>'email',
    r->>'owner_score',
    coalesce(r->'flags', '[]'::jsonb),
    r->>'email_kind',
    r->>'phone_line_type',
    r->>'phone_carrier',
    r->>'officer_name',
    r->>'officer_title',
    r->>'officer_street',
    r->>'officer_city',
    r->>'officer_state',
    r->>'officer_zip',
    r->>'officer_match',
    r->>'taxpayer_id',
    r->>'owner_search_name',
    r->'people_search',
    r->>'owner_cell',
    r->>'owner_cell_source',
    coalesce(nullif(r->>'dial_status', ''), 'needs_enrichment'),
    r->>'evidence',
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where nullif(r->>'list_id', '') is not null
    and nullif(r->>'lead_id', '') is not null
  on conflict (list_id, lead_id) do update set
    place_id = excluded.place_id,
    company_name = excluded.company_name,
    contact_name = excluded.contact_name,
    phone = excluded.phone,
    email = excluded.email,
    owner_score = excluded.owner_score,
    flags = excluded.flags,
    email_kind = excluded.email_kind,
    phone_line_type = excluded.phone_line_type,
    phone_carrier = excluded.phone_carrier,
    officer_name = excluded.officer_name,
    officer_title = excluded.officer_title,
    officer_street = excluded.officer_street,
    officer_city = excluded.officer_city,
    officer_state = excluded.officer_state,
    officer_zip = excluded.officer_zip,
    officer_match = excluded.officer_match,
    taxpayer_id = excluded.taxpayer_id,
    owner_search_name = excluded.owner_search_name,
    people_search = excluded.people_search,
    owner_cell = excluded.owner_cell,
    owner_cell_source = excluded.owner_cell_source,
    dial_status = excluded.dial_status,
    evidence = excluded.evidence,
    updated_at = now();

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'upserted', n);
end;
$function$;

DROP FUNCTION IF EXISTS public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.query_permit_parcel_calling_list(
  p_secret text,
  p_list_id text DEFAULT NULL,
  p_owner text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_dial_status text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  page_size integer := greatest(1, least(coalesce(p_page_size, 25), 50));
  page_no integer := greatest(1, coalesce(p_page, 1));
  total integer := 0;
  rows jsonb;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  with lists as (
    select id, name, owner
    from permit_parcel.calling_lists
    where (p_list_id is null or p_list_id = '' or id = p_list_id)
      and (p_owner is null or p_owner = '' or owner = lower(p_owner))
  ),
  matched as (
    select
      sl.id,
      sl.job_id,
      l.name as list_name,
      l.owner as list_owner,
      sl.name,
      sl.owner_name,
      sl.email,
      sl.phone,
      sl.website,
      sl.city,
      sl.state,
      sl.zip,
      sl.category,
      sl.in_icp,
      e.owner_score,
      e.phone_line_type,
      e.officer_name,
      e.officer_match,
      e.owner_cell,
      e.dial_status,
      e.evidence
    from public.scrape_leads sl
    join lists l on l.id = sl.job_id
    left join permit_parcel.contact_enrichment e
      on e.list_id = sl.job_id and e.lead_id = sl.id
    where (p_city is null or p_city = '' or lower(coalesce(sl.city, '')) = lower(p_city))
      and (p_state is null or p_state = '' or lower(coalesce(sl.state, '')) = lower(p_state))
      and (
        p_has_phone is null
        or (p_has_phone = true and nullif(btrim(coalesce(sl.phone, '')), '') is not null)
        or (p_has_phone = false and nullif(btrim(coalesce(sl.phone, '')), '') is null)
      )
      and (
        p_has_email is null
        or (p_has_email = true and nullif(btrim(coalesce(sl.email, '')), '') is not null)
        or (p_has_email = false and nullif(btrim(coalesce(sl.email, '')), '') is null)
      )
      and (
        p_dial_status is null or p_dial_status = ''
        or e.dial_status = p_dial_status
      )
      and (
        p_q is null or p_q = ''
        or sl.name ilike '%' || p_q || '%'
        or sl.owner_name ilike '%' || p_q || '%'
        or sl.email ilike '%' || p_q || '%'
        or sl.phone ilike '%' || p_q || '%'
        or sl.city ilike '%' || p_q || '%'
        or sl.category ilike '%' || p_q || '%'
        or coalesce(e.officer_name, '') ilike '%' || p_q || '%'
      )
  )
  select count(*)::int into total from matched;

  select coalesce(jsonb_agg(to_jsonb(page_rows)), '[]'::jsonb)
  into rows
  from (
    select *
    from matched
    order by name nulls last, id
    offset (page_no - 1) * page_size
    limit page_size
  ) page_rows;

  return jsonb_build_object(
    'ok', true,
    'total', total,
    'page', page_no,
    'page_size', page_size,
    'total_pages', greatest(1, ceil(total::numeric / page_size)::int),
    'returned', coalesce(jsonb_array_length(rows), 0),
    'rows', rows
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_permit_parcel_setting(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_permit_parcel_setting(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_permit_parcel_calling_list_contacts(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_permit_parcel_enrichment(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, text, integer, integer) TO anon, authenticated, service_role;
