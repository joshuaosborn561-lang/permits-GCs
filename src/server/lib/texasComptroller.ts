import { getSetting, loadAppSettings } from './appSettings.js';

const BASE = 'https://api.comptroller.texas.gov/public-data/v1/public';

export interface ComptrollerOfficer {
  name: string;
  title: string;
  year: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  source: string | null;
  is_registered_agent: boolean;
}

export interface ComptrollerEntity {
  taxpayer_id: string;
  name: string;
  dba: string | null;
  sos_file_number: string | null;
  right_to_transact: string | null;
  registered_agent: string | null;
  officers: ComptrollerOfficer[];
}

const AGENT_RE =
  /\b(c\s*t\s*corporation|ct corporation|corporation service company|\bcsc\b|legalzoom|incorp services|national registered agents|\bnrai\b|capitol corporate|cogency global|united agent group|northwest registered agent|registered agents?\s+inc|registered agent)\b/i;

export function isRegisteredAgentName(name: string): boolean {
  return AGENT_RE.test(name);
}

function headers(key: string): HeadersInit {
  return { Accept: 'application/json', 'x-api-key': key };
}

function cleanName(name: string): string {
  return name
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

export async function searchFranchiseEntities(name: string): Promise<Array<{ taxpayerId: string; name: string }>> {
  await loadAppSettings();
  const key = getSetting('texas_cpa_api_key');
  if (!key) {
    throw new Error('TEXAS_CPA_API_KEY is not set — Cayden can paste it with set_enrichment_api_key');
  }
  const q = cleanName(name);
  if (q.length < 2) return [];
  const url = new URL(`${BASE}/franchise-tax-list`);
  url.searchParams.set('name', q);
  const res = await fetch(url, { headers: headers(key) });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: Array<{ taxpayerId?: string; name?: string }>;
    message?: string;
  } | null;
  if (!res.ok) {
    throw new Error(`Texas CPA search ${res.status}: ${body?.message || res.statusText}`);
  }
  return (body?.data ?? [])
    .filter((r) => r.taxpayerId && r.name)
    .map((r) => ({ taxpayerId: String(r.taxpayerId), name: String(r.name) }));
}

export async function getFranchiseAccount(taxpayerId: string): Promise<ComptrollerEntity | null> {
  await loadAppSettings();
  const key = getSetting('texas_cpa_api_key');
  if (!key) {
    throw new Error('TEXAS_CPA_API_KEY is not set — Cayden can paste it with set_enrichment_api_key');
  }
  const id = taxpayerId.replace(/\D/g, '').padStart(11, '0').slice(-11);
  const res = await fetch(`${BASE}/franchise-tax/${id}`, { headers: headers(key) });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: {
      taxpayerId?: string;
      name?: string;
      dbaName?: string;
      sosFileNumber?: string;
      rightToTransactTX?: string;
      registeredAgentName?: string;
      officerInfo?: Array<{
        AGNT_NM?: string;
        AGNT_TITL_TX?: string;
        AGNT_ACTV_YR?: string;
        AD_STR_POB_TX?: string;
        CITY_NM?: string;
        ST_CD?: string;
        AD_ZP?: string;
        SOURCE?: string;
      }>;
    };
    message?: string;
  } | null;
  if (!res.ok) {
    throw new Error(`Texas CPA detail ${res.status}: ${body?.message || res.statusText}`);
  }
  const d = body?.data;
  if (!d) return null;
  const ra = d.registeredAgentName || '';
  return {
    taxpayer_id: String(d.taxpayerId || id),
    name: d.name || '',
    dba: d.dbaName || null,
    sos_file_number: d.sosFileNumber || null,
    right_to_transact: d.rightToTransactTX || null,
    registered_agent: ra || null,
    officers: (d.officerInfo ?? []).map((o) => {
      const name = (o.AGNT_NM || '').trim();
      return {
        name,
        title: (o.AGNT_TITL_TX || '').trim(),
        year: o.AGNT_ACTV_YR || null,
        street: o.AD_STR_POB_TX || null,
        city: o.CITY_NM || null,
        state: o.ST_CD || null,
        zip: o.AD_ZP || null,
        source: o.SOURCE || null,
        is_registered_agent: isRegisteredAgentName(name) || (!!ra && namesLooselyMatch(name, ra)),
      };
    }),
  };
}

function normPerson(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(JR|SR|II|III|IV|LLC|INC|LP|LTD)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesLooselyMatch(a: string, b: string): boolean {
  const left = normPerson(a);
  const right = normPerson(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const last = (s: string) => s.split(' ').filter(Boolean).slice(-1)[0] || '';
  const first = (s: string) => s.split(' ').filter(Boolean)[0] || '';
  return Boolean(last(left) && last(left) === last(right) && first(left)[0] === first(right)[0]);
}

function companyKey(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(THE|LLC|L L C|INC|INCORPORATED|LTD|LP|LLP|CO|COMPANY|CORP|CORPORATION)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pickBestEntity(
  company: string,
  hits: Array<{ taxpayerId: string; name: string }>,
): { taxpayerId: string; name: string } | null {
  if (!hits.length) return null;
  const target = companyKey(company);
  let best = hits[0]!;
  let bestScore = 0;
  for (const hit of hits) {
    const key = companyKey(hit.name);
    let score = 0;
    if (key === target) score = 100;
    else if (key.includes(target) || target.includes(key)) score = 80;
    else {
      const words = target.split(' ').filter((w) => w.length > 2);
      score = words.filter((w) => key.includes(w)).length * 10;
    }
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return bestScore >= 20 ? best : hits.length === 1 ? hits[0]! : null;
}

export function pickOwnerOfficer(
  contactName: string,
  entity: ComptrollerEntity,
): { officer: ComptrollerOfficer | null; match: 'match' | 'different' | 'none' | 'agent' } {
  const real = entity.officers.filter((o) => o.name && !o.is_registered_agent);
  if (!real.length) {
    if (entity.officers.length) return { officer: entity.officers[0]!, match: 'agent' };
    return { officer: null, match: 'none' };
  }
  if (contactName) {
    const hit = real.find((o) => namesLooselyMatch(o.name, contactName));
    if (hit) return { officer: hit, match: 'match' };
  }
  const ranked = [...real].sort((a, b) => rankTitle(b.title) - rankTitle(a.title));
  return { officer: ranked[0]!, match: contactName ? 'different' : 'none' };
}

function rankTitle(title: string): number {
  const t = title.toUpperCase();
  if (/\b(OWNER|PRESIDENT|MANAGING MEMBER|MANAGER|MEMBER|CEO|FOUNDER)\b/.test(t)) return 3;
  if (/\b(DIRECTOR|VP|VICE|SECRETARY|TREASURER)\b/.test(t)) return 2;
  return 1;
}

export function hasTexasCpa(): boolean {
  return Boolean(getSetting('texas_cpa_api_key'));
}
