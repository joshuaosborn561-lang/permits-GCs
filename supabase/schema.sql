-- Permit & Parcel MCP (repo: joshuaosborn561-lang/permits-GCs)
-- Active schema for parcels + OpenSOS. Applied to google-maps-scraper-leads.
-- See also supabase/migrations/ for incremental RPCs.
--
-- Legacy note: property_pm_finder.* remains in the database from the removed
-- Propwire cascade but is not used by this app.

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

CREATE TABLE IF NOT EXISTS permit_parcel.opensos_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ym text NOT NULL,
  entity_name text NOT NULL,
  state text NOT NULL DEFAULT 'TX',
  cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
