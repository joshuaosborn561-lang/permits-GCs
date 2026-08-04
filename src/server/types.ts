export type LocationType = 'city' | 'radius' | 'county';
export type OwnerType = 'individual' | 'company' | 'trust' | 'unknown';
export type PmConfidence = 'high' | 'medium' | 'low' | 'unresolved';
export type PmSource =
  | 'c/o field'
  | 'LoopNet listing'
  | 'Google search'
  | 'google search cap reached'
  | null;

export type RunStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ContactSource = 'getleads' | 'ai_ark' | 'leadmagic' | 'google_search' | 'cache';

export interface ParsedQueryParams {
  location_type: LocationType;
  location_value: string;
  radius_miles: number | null;
  property_type: 'commercial';
  max_records: number;
  ambiguous?: boolean;
  ambiguity_options?: string[];
  ambiguity_reason?: string | null;
}

export interface CostEstimate {
  step1_propwire: number;
  step2_openai: number;
  step3_loopnet: number;
  step4_google: number;
  step5_contacts_note: string;
  total_low: number;
  total_high: number;
  assumptions: string[];
  disclaimer: string;
}

export interface RunProgress {
  records_pulled: number;
  failed_step_1: number;
  resolved_co: number;
  resolved_loopnet: number;
  resolved_google: number;
  unresolved: number;
  google_cap_reached: number;
  google_searches_used: number;
  contacts_found: number;
  contacts_from_getleads: number;
  contacts_from_ai_ark: number;
  contacts_from_leadmagic: number;
  contacts_from_google: number;
  contacts_from_cache: number;
  contacts_synced_to_scrape_leads: number;
  companies_enriched: number;
  cost_actual: number;
  cost_breakdown: Record<string, number>;
}

export interface GeocodedLocation {
  display_name: string;
  city?: string;
  county?: string;
  state?: string;
  state_code?: string;
  latitude: number;
  longitude: number;
  zip_codes?: string[];
}

export interface PropertyRecord {
  id: string;
  run_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  building_name: string | null;
  owner_entity_name: string | null;
  owner_type: OwnerType | null;
  care_of_company: string | null;
  is_likely_self_managed: boolean | null;
  property_manager_company: string | null;
  pm_confidence: PmConfidence | null;
  pm_source: string | null;
  mailing_address_raw: string | null;
  status: string;
  raw_propwire_data?: unknown;
  raw_loopnet_data?: unknown;
  raw_google_data?: unknown;
}

export interface ContactRecord {
  id: string;
  property_id: string;
  run_id: string;
  property_manager_company: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: ContactSource;
  match_confidence: string | null;
}

export interface ContactExportRow {
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_source: string | null;
  match_confidence: string | null;
  property_manager_company: string | null;
  pm_confidence: string | null;
  pm_source: string | null;
  owner_entity_name: string | null;
  owner_type: string | null;
  care_of_company: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export function emptyProgress(): RunProgress {
  return {
    records_pulled: 0,
    failed_step_1: 0,
    resolved_co: 0,
    resolved_loopnet: 0,
    resolved_google: 0,
    unresolved: 0,
    google_cap_reached: 0,
    google_searches_used: 0,
    contacts_found: 0,
    contacts_from_getleads: 0,
    contacts_from_ai_ark: 0,
    contacts_from_leadmagic: 0,
    contacts_from_google: 0,
    contacts_from_cache: 0,
    contacts_synced_to_scrape_leads: 0,
    companies_enriched: 0,
    cost_actual: 0,
    cost_breakdown: {},
  };
}
