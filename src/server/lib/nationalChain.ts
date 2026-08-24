type NamedCompany = {
  name?: string | null;
  business_name?: string | null;
  dba?: string | null;
  employee_count?: string | null;
};

/** Headcount buckets that only show up on national / public firms in this file. */
const NATIONAL_HEADCOUNT = new Set(['5001 to 10000', '10000+']);

/**
 * Obvious national GCs, public homebuilders, and franchise/public trades.
 * Phrases are matched against a normalised company name. Keep them long
 * enough to avoid local shops (e.g. "Turner Sign", "Webb Air", "Charles Myers").
 */
const NATIONAL_NAME_PHRASES = [
  'balfour beatty',
  'holder construction',
  'austin commercial',
  'dpr construction',
  'whiting-turner',
  'whiting turner',
  'mccarthy building',
  'mccarthy-vaughn',
  'structuretone',
  'structure tone',
  'swinerton',
  'gilbane',
  'skanska',
  'turner construction',
  'hensel phelps',
  'clark construction',
  'barton malow',
  'walsh construction',
  'walsh group',
  'manhattan construction',
  'archer western',
  'bechtel',
  'kiewit',
  'pcl construction',
  'mortenson',
  'sundt construction',
  'fluor corp',
  'fluor corporation',
  'aecom',
  'burns & mcdonnell',
  'burns and mcdonnell',
  'black & veatch',
  'black and veatch',
  'kimley-horn',
  'kimley horn',
  'd r horton',
  'd.r. horton',
  'dr horton',
  'lennar',
  'pulte home',
  'pulte group',
  'kb home',
  'toll brothers',
  'meritage home',
  'taylor morrison',
  'perry homes',
  'century communities',
  'tuff shed',
  'window nation',
  'ies residential',
  'ars rescue rooter',
  'roto rooter',
  'service experts',
  'cintas',
  'siemens industry',
  'siemens ',
  'johnson controls',
  'mastec',
  'primoris',
  'ericsson',
  'comfort systems usa',
  'emcor',
  'the home depot',
  'home depot',
  "lowe's",
  'lowes home',
  'arco/ murray',
  'arco/murray',
  'national construct',
];

export interface NationalChainHit {
  national_chain: boolean;
  reason: string | null;
}

export function normalizeCompanyName(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9&/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nationalChainHit(c: NamedCompany): NationalChainHit {
  const hay = [c.business_name, c.name, c.dba].map(normalizeCompanyName).filter(Boolean).join(' | ');
  for (const phrase of NATIONAL_NAME_PHRASES) {
    if (hay.includes(phrase)) {
      return { national_chain: true, reason: `name:${phrase}` };
    }
  }
  const emp = (c.employee_count || '').trim();
  if (NATIONAL_HEADCOUNT.has(emp)) {
    return { national_chain: true, reason: `employees:${emp}` };
  }
  return { national_chain: false, reason: null };
}

export function isNationalChain(c: NamedCompany): boolean {
  return nationalChainHit(c).national_chain;
}
