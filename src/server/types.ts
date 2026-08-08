export type OwnerType = 'individual' | 'local_llc' | 'institutional' | 'unknown';

export type CountyCode = 'Dallas' | 'Tarrant' | 'Collin';

export interface ParcelRecord {
  id: string;
  county: CountyCode;
  account_id: string;
  owner_name: string;
  mailing_address: string | null;
  parcel_address: string | null;
  city: string | null;
  zip: string | null;
  assessed_value: number | null;
  use_code: string | null;
  prop_type: string | null;
  owner_type: OwnerType;
}

export interface OpenSosOfficer {
  name: string;
  title: string | null;
}

export interface OpenSosResult {
  entity_name: string;
  state: string;
  status: string | null;
  entity_type: string | null;
  formation_date: string | null;
  registered_agent: string | null;
  registered_agent_address: string | null;
  officers: OpenSosOfficer[];
  managing_members: string[];
  cost: number;
  cached: boolean;
  raw?: Record<string, unknown>;
}
