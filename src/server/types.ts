export type OwnerType =
  | 'individual'
  | 'local_llc'
  | 'institutional'
  | 'municipal'
  | 'unknown';

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

