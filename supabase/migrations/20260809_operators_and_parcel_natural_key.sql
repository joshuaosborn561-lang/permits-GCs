-- P0/P1: document natural key + municipal (already applied on kemvxzhcxvynmoutwdrh)
-- and fix replace_permit_parcel_operators to match live operators columns.

-- Ensure municipal owner_type is allowed (idempotent)
ALTER TABLE permit_parcel.parcels
  DROP CONSTRAINT IF EXISTS parcels_owner_type_check;

ALTER TABLE permit_parcel.parcels
  ADD CONSTRAINT parcels_owner_type_check
  CHECK (owner_type = ANY (ARRAY[
    'individual'::text,
    'local_llc'::text,
    'institutional'::text,
    'municipal'::text,
    'unknown'::text
  ]));

-- Natural key (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'permit_parcel.parcels'::regclass
      AND conname = 'parcels_county_account_id_key'
  ) THEN
    ALTER TABLE permit_parcel.parcels
      ADD CONSTRAINT parcels_county_account_id_key UNIQUE (county, account_id);
  END IF;
END $$;

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
    coalesce(nullif(row->>'county',''), 'unknown') || ':' || coalesce(nullif(row->>'account_id',''), 'unknown'),
    coalesce(row->>'county', ''),
    coalesce(row->>'account_id', ''),
    coalesce(row->>'owner_name', ''),
    nullif(row->>'mailing_address', ''),
    nullif(row->>'parcel_address', ''),
    nullif(row->>'city', ''),
    nullif(row->>'zip', ''),
    nullif(row->>'assessed_value', '')::numeric,
    nullif(row->>'use_code', ''),
    nullif(row->>'prop_type', ''),
    coalesce(nullif(row->>'owner_type', ''), 'unknown'),
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  where coalesce(row->>'county', '') <> ''
    and coalesce(row->>'account_id', '') <> ''
  on conflict (county, account_id) do update set
    id = excluded.id,
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

-- Match live permit_parcel.operators columns (county_list text, no id/updated_at)
CREATE OR REPLACE FUNCTION public.replace_permit_parcel_operators(
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

  truncate permit_parcel.operators;

  insert into permit_parcel.operators (
    operator_address, parcels, distinct_llcs, portfolio_value, largest_parcel_value,
    counties, county_list, top_llc, top_parcel_address, has_local_llc,
    operator_name, domain, website, phone, place_id, confidence, resolved, resolved_at
  )
  select
    row->>'operator_address',
    coalesce((row->>'parcels')::bigint, 0),
    coalesce((row->>'distinct_llcs')::bigint, 0),
    coalesce((row->>'portfolio_value')::bigint, 0),
    coalesce((row->>'largest_parcel_value')::bigint, 0),
    coalesce((row->>'counties')::bigint, 0),
    coalesce(
      CASE
        WHEN jsonb_typeof(row->'county_list') = 'array'
          THEN (
            SELECT string_agg(value, ', ' ORDER BY value)
            FROM jsonb_array_elements_text(row->'county_list') AS t(value)
          )
        ELSE nullif(row->>'county_list', '')
      END,
      ''
    ),
    row->>'top_llc',
    row->>'top_parcel_address',
    coalesce((row->>'has_local_llc')::boolean, false),
    row->>'operator_name',
    row->>'domain',
    row->>'website',
    row->>'phone',
    row->>'place_id',
    nullif(row->>'confidence', '')::double precision,
    coalesce((row->>'resolved')::boolean, false),
    nullif(row->>'resolved_at', '')::timestamptz
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  where coalesce(row->>'operator_address', '') <> '';

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'operators_built', n, 'inserted', n);
end;
$function$;
