-- Remove legacy OpenSOS and add named calling lists for MCP / cold-calling filters.

DROP FUNCTION IF EXISTS public.ingest_permit_parcel_opensos(text, jsonb);
DROP FUNCTION IF EXISTS public.fetch_permit_parcel_opensos(text, text, text);
DROP FUNCTION IF EXISTS public.count_opensos_usage(text, text);
DROP FUNCTION IF EXISTS public.record_opensos_usage(text, text, text, numeric);

DROP TABLE IF EXISTS permit_parcel.opensos_lookups;
DROP TABLE IF EXISTS permit_parcel.opensos_usage;

CREATE TABLE IF NOT EXISTS permit_parcel.calling_lists (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner text NOT NULL DEFAULT 'shared',
  source text NOT NULL DEFAULT 'shovels_contractors',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pp_calling_lists_owner ON permit_parcel.calling_lists (owner);
CREATE INDEX IF NOT EXISTS idx_pp_calling_lists_updated ON permit_parcel.calling_lists (updated_at DESC);

ALTER TABLE permit_parcel.calling_lists ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.upsert_permit_parcel_calling_list(
  p_secret text,
  p_list jsonb
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

  insert into permit_parcel.calling_lists (
    id, name, owner, source, filters, row_count, created_at, updated_at
  ) values (
    coalesce(p_list->>'id', ''),
    coalesce(p_list->>'name', 'Untitled list'),
    lower(coalesce(nullif(p_list->>'owner', ''), 'shared')),
    coalesce(p_list->>'source', 'shovels_contractors'),
    coalesce(p_list->'filters', '{}'::jsonb),
    coalesce((p_list->>'row_count')::integer, 0),
    now(),
    now()
  )
  on conflict (id) do update set
    name = excluded.name,
    owner = excluded.owner,
    source = excluded.source,
    filters = excluded.filters,
    row_count = excluded.row_count,
    updated_at = now();

  return jsonb_build_object('ok', true, 'id', p_list->>'id');
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_permit_parcel_calling_lists(
  p_secret text,
  p_owner text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  rows jsonb;
  n integer;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  with filtered as (
    select
      c.id,
      c.name,
      c.owner,
      c.source,
      c.filters,
      c.row_count,
      c.created_at,
      c.updated_at
    from permit_parcel.calling_lists c
    where (p_owner is null or p_owner = '' or c.owner = lower(p_owner))
      and (
        p_q is null or p_q = ''
        or c.name ilike '%' || p_q || '%'
        or c.owner ilike '%' || p_q || '%'
        or c.id ilike '%' || p_q || '%'
      )
    order by c.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(to_jsonb(filtered)), '[]'::jsonb)
  into rows
  from filtered;

  n := coalesce(jsonb_array_length(rows), 0);
  return jsonb_build_object('ok', true, 'count', n, 'lists', rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.query_permit_parcel_calling_list(
  p_secret text,
  p_list_id text DEFAULT NULL,
  p_owner text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
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
      sl.in_icp
    from public.scrape_leads sl
    join lists l on l.id = sl.job_id
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
        p_q is null or p_q = ''
        or sl.name ilike '%' || p_q || '%'
        or sl.owner_name ilike '%' || p_q || '%'
        or sl.email ilike '%' || p_q || '%'
        or sl.phone ilike '%' || p_q || '%'
        or sl.city ilike '%' || p_q || '%'
        or sl.category ilike '%' || p_q || '%'
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

GRANT EXECUTE ON FUNCTION public.upsert_permit_parcel_calling_list(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_permit_parcel_calling_lists(text, text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, integer, integer) TO anon, authenticated, service_role;
