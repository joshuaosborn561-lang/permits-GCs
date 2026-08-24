-- Permit-count band + national-chain flag on calling-list queries.
-- New saves store permit_count and national_chain in scrape_leads.raw.

DROP FUNCTION IF EXISTS public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, text, integer, integer);
DROP FUNCTION IF EXISTS public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, text, integer, integer, integer, integer);

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
  p_min_permit_count integer DEFAULT NULL,
  p_max_permit_count integer DEFAULT NULL,
  p_exclude_national_chains boolean DEFAULT NULL,
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
      sl.place_id,
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
      case
        when sl.raw->>'permit_count' ~ '^[0-9]+$' then (sl.raw->>'permit_count')::int
        else sl.reviews
      end as permit_count,
      lower(coalesce(sl.raw->>'national_chain', '')) in ('true', 't', '1', 'yes') as national_chain,
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
        p_min_permit_count is null
        or case
          when sl.raw->>'permit_count' ~ '^[0-9]+$' then (sl.raw->>'permit_count')::int
          else sl.reviews
        end >= p_min_permit_count
      )
      and (
        p_max_permit_count is null
        or case
          when sl.raw->>'permit_count' ~ '^[0-9]+$' then (sl.raw->>'permit_count')::int
          else sl.reviews
        end <= p_max_permit_count
      )
      and (
        p_exclude_national_chains is not true
        or lower(coalesce(sl.raw->>'national_chain', '')) not in ('true', 't', '1', 'yes')
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
    order by permit_count nulls last, name nulls last, id
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

GRANT EXECUTE ON FUNCTION public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, text, integer, integer, boolean, integer, integer) TO anon, authenticated, service_role;
