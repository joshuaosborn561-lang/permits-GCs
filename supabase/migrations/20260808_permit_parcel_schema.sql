-- Permit & Parcel MCP schema + ingest RPCs
-- Applied to google-maps-scraper-leads (kemvxzhcxvynmoutwdrh).

CREATE SCHEMA IF NOT EXISTS permit_parcel;

CREATE TABLE IF NOT EXISTS permit_parcel.parcels (
  id text PRIMARY KEY,
  county text NOT NULL,
  account_id text NOT NULL,
  owner_name text NOT NULL DEFAULT '',
  mailing_address text,
  parcel_address text,
  city text,
  zip text,
  assessed_value numeric,
  use_code text,
  prop_type text,
  owner_type text NOT NULL DEFAULT 'unknown'
    CHECK (owner_type = ANY (ARRAY[
      'individual'::text, 'local_llc'::text, 'institutional'::text, 'unknown'::text
    ])),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pp_parcels_county ON permit_parcel.parcels (county);
CREATE INDEX IF NOT EXISTS idx_pp_parcels_owner_type ON permit_parcel.parcels (owner_type);
CREATE INDEX IF NOT EXISTS idx_pp_parcels_zip ON permit_parcel.parcels (zip);
CREATE INDEX IF NOT EXISTS idx_pp_parcels_owner_name ON permit_parcel.parcels (owner_name);

CREATE TABLE IF NOT EXISTS permit_parcel.opensos_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name text NOT NULL,
  state text NOT NULL DEFAULT 'TX',
  status text,
  entity_type text,
  formation_date text,
  registered_agent text,
  registered_agent_address text,
  officers jsonb NOT NULL DEFAULT '[]'::jsonb,
  managing_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost numeric NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  looked_up_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_name, state)
);

ALTER TABLE permit_parcel.parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_parcel.opensos_lookups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ingest_permit_parcel_parcels(
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

  insert into permit_parcel.parcels (
    id, county, account_id, owner_name, mailing_address, parcel_address,
    city, zip, assessed_value, use_code, prop_type, owner_type, updated_at
  )
  select
    coalesce(row->>'id', md5(coalesce(row->>'county','') || ':' || coalesce(row->>'account_id',''))),
    coalesce(row->>'county', ''),
    coalesce(row->>'account_id', ''),
    coalesce(row->>'owner_name', ''),
    row->>'mailing_address',
    row->>'parcel_address',
    row->>'city',
    row->>'zip',
    nullif(row->>'assessed_value', '')::numeric,
    row->>'use_code',
    row->>'prop_type',
    coalesce(row->>'owner_type', 'unknown'),
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  on conflict (id) do update set
    owner_name = excluded.owner_name,
    mailing_address = excluded.mailing_address,
    parcel_address = excluded.parcel_address,
    city = excluded.city,
    zip = excluded.zip,
    assessed_value = excluded.assessed_value,
    use_code = excluded.use_code,
    prop_type = excluded.prop_type,
    owner_type = excluded.owner_type,
    updated_at = now();

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'upserted', n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_permit_parcel_opensos(
  p_secret text,
  p_row jsonb
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

  insert into permit_parcel.opensos_lookups (
    entity_name, state, status, entity_type, formation_date,
    registered_agent, registered_agent_address, officers, managing_members,
    cost, raw, looked_up_at
  ) values (
    coalesce(p_row->>'entity_name', ''),
    coalesce(p_row->>'state', 'TX'),
    p_row->>'status',
    p_row->>'entity_type',
    p_row->>'formation_date',
    p_row->>'registered_agent',
    p_row->>'registered_agent_address',
    coalesce(p_row->'officers', '[]'::jsonb),
    coalesce(p_row->'managing_members', '[]'::jsonb),
    coalesce((p_row->>'cost')::numeric, 0),
    coalesce(p_row->'raw', '{}'::jsonb),
    coalesce((p_row->>'looked_up_at')::timestamptz, now())
  )
  on conflict (entity_name, state) do update set
    status = excluded.status,
    entity_type = excluded.entity_type,
    formation_date = excluded.formation_date,
    registered_agent = excluded.registered_agent,
    registered_agent_address = excluded.registered_agent_address,
    officers = excluded.officers,
    managing_members = excluded.managing_members,
    cost = excluded.cost,
    raw = excluded.raw,
    looked_up_at = excluded.looked_up_at;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fetch_permit_parcel_opensos(
  p_secret text,
  p_entity_name text,
  p_state text DEFAULT 'TX'
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

  select to_jsonb(o) into row_json
  from permit_parcel.opensos_lookups o
  where lower(o.entity_name) = lower(p_entity_name)
    and upper(o.state) = upper(coalesce(p_state, 'TX'))
  order by o.looked_up_at desc
  limit 1;

  if row_json is null then
    return jsonb_build_object('ok', true, 'found', false);
  end if;

  return row_json || jsonb_build_object('ok', true, 'found', true);
end;
$function$;

-- Idempotent scrape_leads replace (Maps-style sync helper)
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
  return jsonb_build_object('ok', true, 'deleted', deleted_count, 'inserted', inserted_count);
end;
$function$;
