-- Property PM Finder schema for SalesGlider Growth
-- Applied to google-maps-scraper-leads project (kemvxzhcxvynmoutwdrh).
-- Does not modify existing public.scrape_* table definitions; the app also
-- mirrors completed contacts into public.scrape_jobs / public.scrape_leads.

CREATE SCHEMA IF NOT EXISTS property_pm_finder;

CREATE TABLE IF NOT EXISTS property_pm_finder.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  natural_language_query text NOT NULL,
  parsed_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'awaiting_confirmation', 'running', 'completed', 'failed', 'cancelled'
    )),
  current_step text,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_records integer NOT NULL DEFAULT 0,
  total_cost_estimate numeric(12, 6) NOT NULL DEFAULT 0,
  total_cost_actual numeric(12, 6) NOT NULL DEFAULT 0,
  cost_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text
);

CREATE TABLE IF NOT EXISTS property_pm_finder.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES property_pm_finder.runs(id) ON DELETE CASCADE,
  address text,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  building_name text,
  owner_entity_name text,
  owner_type text CHECK (owner_type IS NULL OR owner_type IN ('individual', 'company', 'trust', 'unknown')),
  care_of_company text,
  is_likely_self_managed boolean,
  property_manager_company text,
  pm_confidence text CHECK (pm_confidence IS NULL OR pm_confidence IN ('high', 'medium', 'low', 'unresolved')),
  pm_source text,
  mailing_address_raw text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'parsed', 'pm_resolved', 'pm_unresolved', 'failed_step_1', 'enriching', 'enriched', 'failed'
    )),
  raw_propwire_data jsonb,
  raw_loopnet_data jsonb,
  raw_google_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmf_properties_run_id ON property_pm_finder.properties(run_id);
CREATE INDEX IF NOT EXISTS idx_pmf_properties_city_state ON property_pm_finder.properties(city, state);
CREATE INDEX IF NOT EXISTS idx_pmf_properties_pm_company ON property_pm_finder.properties(property_manager_company);

CREATE TABLE IF NOT EXISTS property_pm_finder.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property_pm_finder.properties(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES property_pm_finder.runs(id) ON DELETE CASCADE,
  property_manager_company text NOT NULL,
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  source text NOT NULL CHECK (source IN ('getleads', 'ai_ark', 'leadmagic', 'google_search', 'cache')),
  match_confidence text CHECK (match_confidence IS NULL OR match_confidence IN ('high', 'medium', 'low', 'soft')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmf_contacts_run_id ON property_pm_finder.contacts(run_id);
CREATE INDEX IF NOT EXISTS idx_pmf_contacts_property_id ON property_pm_finder.contacts(property_id);
CREATE INDEX IF NOT EXISTS idx_pmf_contacts_pm_company ON property_pm_finder.contacts(property_manager_company);

CREATE TABLE IF NOT EXISTS property_pm_finder.pm_company_contact_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_manager_company text NOT NULL,
  company_key text NOT NULL UNIQUE,
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  source text NOT NULL,
  match_confidence text,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_pm_finder.openai_debug_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES property_pm_finder.runs(id) ON DELETE CASCADE,
  property_id uuid REFERENCES property_pm_finder.properties(id) ON DELETE SET NULL,
  step text NOT NULL,
  model text,
  raw_input text,
  raw_output text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmf_openai_logs_run_id ON property_pm_finder.openai_debug_logs(run_id);

ALTER TABLE property_pm_finder.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_pm_finder.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_pm_finder.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_pm_finder.pm_company_contact_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_pm_finder.openai_debug_logs ENABLE ROW LEVEL SECURITY;
