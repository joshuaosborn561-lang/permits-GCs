-- OpenSOS monthly usage ledger (1000/month hard cap in app)

CREATE TABLE IF NOT EXISTS permit_parcel.opensos_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ym text NOT NULL,
  entity_name text NOT NULL,
  state text NOT NULL DEFAULT 'TX',
  cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pp_opensos_usage_ym ON permit_parcel.opensos_usage (ym);
ALTER TABLE permit_parcel.opensos_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.count_opensos_usage(
  p_secret text,
  p_ym text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  target_ym text := coalesce(nullif(p_ym, ''), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'));
  n integer;
  total_cost numeric;
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  select count(*)::int, coalesce(sum(u.cost), 0)
  into n, total_cost
  from permit_parcel.opensos_usage u
  where u.ym = target_ym;

  return jsonb_build_object(
    'ok', true,
    'ym', target_ym,
    'used', n,
    'total_cost', total_cost
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_opensos_usage(
  p_secret text,
  p_entity_name text,
  p_state text DEFAULT 'TX',
  p_cost numeric DEFAULT 0.0314
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'permit_parcel'
AS $function$
declare
  expected text;
  ym text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
begin
  select value into expected from private.app_secrets where key = 'ingest_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'unauthorized';
  end if;

  insert into permit_parcel.opensos_usage (ym, entity_name, state, cost)
  values (ym, coalesce(p_entity_name, ''), coalesce(p_state, 'TX'), coalesce(p_cost, 0));

  return jsonb_build_object('ok', true, 'ym', ym);
end;
$function$;
