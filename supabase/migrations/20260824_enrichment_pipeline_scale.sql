-- Fix query_calling_list ("relation matched does not exist") and add
-- resume/filter params so scoring + officer match can walk 6k-row lists.

DROP FUNCTION IF EXISTS public.fetch_permit_parcel_calling_list_contacts(text, text, integer);
DROP FUNCTION IF EXISTS public.fetch_permit_parcel_calling_list_contacts(text, text, integer, integer, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.fetch_permit_parcel_calling_list_contacts(text, text, integer, integer, boolean, boolean, boolean, bigint);

CREATE OR REPLACE FUNCTION public.fetch_permit_parcel_calling_list_contacts(
  p_secret text,
  p_list_id text,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_unscored_only boolean DEFAULT false,
  p_unmatched_only boolean DEFAULT false,
  p_unknown_line_type_only boolean DEFAULT false,
  p_lead_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  rows jsonb;
  total_n integer := 0;
  unscored_n integer := 0;
  unmatched_n integer := 0;
  unknown_line_n integer := 0;
  lim integer := greatest(1, least(coalesce(p_limit, 500), 8000));
  off integer := greatest(0, coalesce(p_offset, 0));
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  if p_list_id is null or p_list_id = '' then
    return jsonb_build_object('ok', false, 'error', 'list_id required', 'rows', '[]'::jsonb);
  end if;

  select
    count(*)::int,
    count(*) filter (where e.owner_score is null)::int,
    count(*) filter (where e.officer_match is null)::int,
    count(*) filter (where e.phone_line_type is null and nullif(btrim(coalesce(sl.phone, '')), '') is not null)::int
  into total_n, unscored_n, unmatched_n, unknown_line_n
  from public.scrape_leads sl
  left join permit_parcel.contact_enrichment e
    on e.list_id = sl.job_id and e.lead_id = sl.id
  where sl.job_id = p_list_id
    and (p_lead_id is null or sl.id = p_lead_id);

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
      and (p_lead_id is null or sl.id = p_lead_id)
      and (p_unscored_only is not true or e.owner_score is null)
      and (p_unmatched_only is not true or e.officer_match is null)
      and (p_unknown_line_type_only is not true or e.phone_line_type is null)
    order by sl.name nulls last, sl.id
    offset off
    limit lim
  ) x;

  return jsonb_build_object(
    'ok', true,
    'rows', rows,
    'total', total_n,
    'offset', off,
    'limit', lim,
    'returned', coalesce(jsonb_array_length(rows), 0),
    'remaining_unscored', unscored_n,
    'remaining_unmatched', unmatched_n,
    'remaining_unknown_line_type', unknown_line_n
  );
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
  result jsonb;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  -- One statement so the `matched` CTE is in scope for both count and page.
  -- Prior versions selected INTO then queried `matched` again → relation does not exist.
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
        or coalesce(e.dial_status, 'needs_enrichment') = p_dial_status
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
  ),
  stats as (
    select count(*)::int as total from matched
  ),
  page_rows as (
    select *
    from matched
    order by permit_count nulls last, name nulls last, id
    offset (page_no - 1) * page_size
    limit page_size
  )
  select jsonb_build_object(
    'ok', true,
    'total', stats.total,
    'page', page_no,
    'page_size', page_size,
    'total_pages', greatest(1, ceil(stats.total::numeric / page_size)::int),
    'returned', (select count(*)::int from page_rows),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.permit_count nulls last, p.name nulls last, p.id)
      from page_rows p
    ), '[]'::jsonb)
  )
  into result
  from stats;

  return result;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_permit_parcel_calling_list_contacts(text, text, integer, integer, boolean, boolean, boolean, bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.query_permit_parcel_calling_list(text, text, text, text, text, text, boolean, boolean, text, integer, integer, boolean, integer, integer) TO anon, authenticated, service_role;
