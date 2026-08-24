import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import { supabaseTargetMeta } from '../lib/supabaseTarget.js';
import {
  computeDialStatus,
  scoreContact,
  type DialStatus,
  type OwnerScore,
} from '../lib/contactScore.js';
import { buildPeopleSearchPack } from '../lib/peopleSearch.js';
import { getShovelsContractor } from './shovelsContractors.js';
import {
  getFranchiseAccount,
  hasTexasCpa,
  pickBestEntity,
  pickOwnerOfficer,
  searchFranchiseEntities,
} from '../lib/texasComptroller.js';
import {
  estimateVeriphoneUsd,
  hasVeriphone,
  lookupVeriphone,
} from '../lib/veriphone.js';
import { loadAppSettings } from '../lib/appSettings.js';

export interface EnrichmentRow {
  list_id: string;
  lead_id: number;
  place_id?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  owner_score?: OwnerScore | string | null;
  flags?: string[] | null;
  email_kind?: string | null;
  phone_line_type?: string | null;
  phone_carrier?: string | null;
  officer_name?: string | null;
  officer_title?: string | null;
  officer_street?: string | null;
  officer_city?: string | null;
  officer_state?: string | null;
  officer_zip?: string | null;
  officer_match?: string | null;
  taxpayer_id?: string | null;
  owner_search_name?: string | null;
  people_search?: Record<string, unknown> | null;
  owner_cell?: string | null;
  owner_cell_source?: string | null;
  dial_status?: DialStatus | string | null;
  evidence?: string | null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function digits(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

function countBy(rows: EnrichmentRow[], key: keyof EnrichmentRow) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] || 'unknown');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function applyDial(row: EnrichmentRow): EnrichmentRow {
  row.dial_status = computeDialStatus({
    owner_score: row.owner_score || 'needs_enrichment',
    email_kind: row.email_kind || null,
    line_type: row.phone_line_type || null,
    officer_match: row.officer_match || null,
    owner_cell: row.owner_cell || null,
  });
  return row;
}

async function fetchContacts(listId: string, limit: number): Promise<EnrichmentRow[]> {
  if (!hasSupabase()) throw new Error('Supabase not configured');
  const { data, error } = await getSupabase().rpc('fetch_permit_parcel_calling_list_contacts', {
    p_secret: ingestSecret(),
    p_list_id: listId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; rows?: EnrichmentRow[]; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return (payload?.rows ?? []) as EnrichmentRow[];
}

async function persistRows(rows: EnrichmentRow[]): Promise<string | null> {
  if (!rows.length) return null;
  const { error } = await getSupabase().rpc('upsert_permit_parcel_enrichment', {
    p_secret: ingestSecret(),
    p_rows: rows.map((r) => ({
      list_id: r.list_id,
      lead_id: r.lead_id,
      place_id: r.place_id ?? null,
      company_name: r.company_name ?? null,
      contact_name: r.contact_name ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      owner_score: r.owner_score ?? null,
      flags: Array.isArray(r.flags) ? r.flags : [],
      email_kind: r.email_kind ?? null,
      phone_line_type: r.phone_line_type ?? null,
      phone_carrier: r.phone_carrier ?? null,
      officer_name: r.officer_name ?? null,
      officer_title: r.officer_title ?? null,
      officer_street: r.officer_street ?? null,
      officer_city: r.officer_city ?? null,
      officer_state: r.officer_state ?? null,
      officer_zip: r.officer_zip ?? null,
      officer_match: r.officer_match ?? null,
      taxpayer_id: r.taxpayer_id ?? null,
      owner_search_name: r.owner_search_name ?? null,
      people_search: r.people_search ?? null,
      owner_cell: r.owner_cell ?? null,
      owner_cell_source: r.owner_cell_source ?? null,
      dial_status: r.dial_status ?? 'needs_enrichment',
      evidence: r.evidence ?? null,
    })),
  });
  return error ? error.message : null;
}

function sample(rows: EnrichmentRow[], n = 8) {
  return rows.slice(0, n).map((r) => ({
    lead_id: r.lead_id,
    company_name: r.company_name,
    contact_name: r.contact_name,
    owner_score: r.owner_score,
    officer_name: r.officer_name,
    officer_match: r.officer_match,
    phone_line_type: r.phone_line_type,
    dial_status: r.dial_status,
    evidence: r.evidence,
  }));
}

export async function scoreCallingList(opts: {
  list_id: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const listId = opts.list_id.trim();
  const rows = await fetchContacts(listId, opts.limit ?? 500);
  const phoneCounts = new Map<string, number>();
  for (const r of rows) {
    const d = digits(r.phone || '');
    if (d) phoneCounts.set(d, (phoneCounts.get(d) || 0) + 1);
  }
  const scored = rows.map((r) => {
    const extra = r.place_id?.startsWith('shovels:')
      ? getShovelsContractor(r.place_id.slice('shovels:'.length))
      : null;
    const scoredRow = scoreContact({
      company_name: r.company_name || extra?.business_name || extra?.name || '',
      contact_name: r.contact_name || extra?.name || '',
      email: r.email || extra?.email || extra?.primary_email || '',
      phone: r.phone || extra?.phone || extra?.primary_phone || '',
      city: r.city || extra?.address_city || '',
      phone_share_count: phoneCounts.get(digits(r.phone || '')) || 1,
    });
    return applyDial({
      ...r,
      owner_score: scoredRow.owner_score,
      flags: scoredRow.flags,
      email_kind: scoredRow.email_kind,
      evidence: scoredRow.evidence,
    });
  });
  const persistError = await persistRows(scored);
  return {
    ok: !persistError,
    error: persistError,
    ...supabaseTargetMeta(),
    scored: scored.length,
    by_owner_score: countBy(scored, 'owner_score'),
    by_dial_status: countBy(scored, 'dial_status'),
    sample: sample(scored),
    assistant_instructions:
      'Free score only. Next: match_texas_officers, then lookup_line_type (confirm + show $ estimate). Do not dump the list.',
  };
}

export async function matchTexasOfficers(opts: {
  list_id: string;
  limit?: number;
  only_unmatched?: boolean;
}): Promise<Record<string, unknown>> {
  await loadAppSettings();
  if (!hasTexasCpa()) {
    return {
      ok: false,
      error: 'Texas Comptroller API key is not set. Cayden pastes it with set_enrichment_api_key(key=texas_cpa_api_key).',
    };
  }
  const rows = await fetchContacts(opts.list_id.trim(), opts.limit ?? 200);
  const targets = rows.filter((r) => {
    if (opts.only_unmatched !== false && r.officer_match) return false;
    return Boolean(r.company_name || r.contact_name);
  });
  let matched = 0;
  let different = 0;
  let none = 0;
  let errors = 0;
  for (const row of targets) {
    try {
      const hits = await searchFranchiseEntities(row.company_name || '');
      const best = pickBestEntity(row.company_name || '', hits);
      if (!best) {
        row.officer_match = 'none';
        none += 1;
      } else {
        const entity = await getFranchiseAccount(best.taxpayerId);
        if (!entity) {
          row.officer_match = 'none';
          none += 1;
        } else {
          const picked = pickOwnerOfficer(row.contact_name || '', entity);
          row.taxpayer_id = entity.taxpayer_id;
          row.officer_name = picked.officer?.name ?? null;
          row.officer_title = picked.officer?.title ?? null;
          row.officer_street = picked.officer?.street ?? null;
          row.officer_city = picked.officer?.city ?? row.city ?? null;
          row.officer_state = picked.officer?.state ?? row.state ?? 'TX';
          row.officer_zip = picked.officer?.zip ?? row.zip ?? null;
          row.officer_match = picked.match;
          if (picked.match === 'match') matched += 1;
          else if (picked.match === 'different') different += 1;
          else none += 1;
        }
      }
      applyDial(row);
      await sleep(120);
    } catch (err) {
      errors += 1;
      row.evidence = [row.evidence, err instanceof Error ? err.message : 'officer lookup failed']
        .filter(Boolean)
        .join(' · ');
    }
  }
  const persistError = await persistRows(targets);
  return {
    ok: !persistError,
    error: persistError,
    ...supabaseTargetMeta(),
    processed: targets.length,
    matched,
    different,
    none,
    errors,
    by_officer_match: { match: matched, different, none, errors },
    sample: sample(targets),
    assistant_instructions:
      'Officer names are public PIR data. If match=different, Google the officer name (not the Shovels PM). Next lookup_line_type or owner_people_search.',
  };
}

export async function lookupLineTypes(opts: {
  list_id: string;
  confirm?: boolean;
  limit?: number;
  only_unknown?: boolean;
}): Promise<Record<string, unknown>> {
  await loadAppSettings();
  const rows = await fetchContacts(opts.list_id.trim(), opts.limit ?? 200);
  const targets = rows.filter((r) => {
    if (!digits(r.phone || '')) return false;
    if (opts.only_unknown !== false && r.phone_line_type) return false;
    return true;
  });
  const estimate = estimateVeriphoneUsd(targets.length);
  if (opts.confirm !== true) {
    return {
      ok: false,
      needs_confirm: true,
      ...estimate,
      ...supabaseTargetMeta(),
      error: `Would look up ${targets.length} numbers (~$${estimate.usd}). Set confirm=true to spend Veriphone credits.`,
    };
  }
  if (!hasVeriphone()) {
    return {
      ok: false,
      error: 'Veriphone API key is not set. Cayden pastes it with set_enrichment_api_key(key=veriphone_api_key).',
      ...estimate,
    };
  }
  let looked = 0;
  let errors = 0;
  for (const row of targets) {
    try {
      const hit = await lookupVeriphone(row.phone || '');
      row.phone_line_type = hit.normalized_type;
      row.phone_carrier = hit.carrier;
      applyDial(row);
      looked += 1;
      await sleep(80);
    } catch (err) {
      errors += 1;
      row.evidence = [row.evidence, err instanceof Error ? err.message : 'veriphone failed']
        .filter(Boolean)
        .join(' · ');
    }
  }
  const persistError = await persistRows(targets);
  return {
    ok: !persistError,
    error: persistError,
    ...supabaseTargetMeta(),
    looked_up: looked,
    errors,
    spent: estimateVeriphoneUsd(looked),
    by_line_type: countBy(targets, 'phone_line_type'),
    by_dial_status: countBy(targets, 'dial_status'),
    sample: sample(targets),
    assistant_instructions:
      'Show line-type counts and $ spent. owner_cell = mobile + owner identity. Leftovers go to owner_people_search.',
  };
}

export async function ownerPeopleSearch(opts: {
  list_id: string;
  limit?: number;
  dial_status?: string;
}): Promise<Record<string, unknown>> {
  const rows = await fetchContacts(opts.list_id.trim(), 500);
  const want = opts.dial_status || 'needs_enrichment';
  const leftovers = rows
    .filter((r) => (r.dial_status || 'needs_enrichment') === want)
    .slice(0, opts.limit ?? 25);
  const packs = leftovers
    .map((r) => {
      const extra = r.place_id?.startsWith('shovels:')
        ? getShovelsContractor(r.place_id.slice('shovels:'.length))
        : null;
      const searchName = r.officer_name || r.contact_name || '';
      const pack = buildPeopleSearchPack({
        name: searchName,
        city: r.officer_city || r.city || extra?.address_city,
        state: r.officer_state || r.state || extra?.address_state || 'TX',
        zip: r.officer_zip || r.zip || extra?.address_zip,
        street: r.officer_street || extra?.address_street,
      });
      if (!pack) return null;
      r.owner_search_name = pack.search_name;
      r.people_search = { ...pack };
      applyDial(r);
      return {
        lead_id: r.lead_id,
        company_name: r.company_name,
        officer_match: r.officer_match,
        ...pack,
      };
    })
    .filter(Boolean);
  await persistRows(leftovers);
  return {
    ok: true,
    ...supabaseTargetMeta(),
    leftover_count: leftovers.length,
    returned: packs.length,
    packs,
    assistant_instructions:
      'Open the FastPeopleSearch/TruePeopleSearch URL. Prefer a hit matching the officer street/city. Take wireless only. Then record_owner_cell. Do not paste every directory row into chat.',
  };
}

export async function recordOwnerCell(opts: {
  list_id: string;
  lead_id: number;
  phone: string;
  source?: string;
  line_type?: string;
}): Promise<Record<string, unknown>> {
  const rows = await fetchContacts(opts.list_id.trim(), 2000);
  const row = rows.find((r) => Number(r.lead_id) === Number(opts.lead_id));
  if (!row) return { ok: false, error: `Lead ${opts.lead_id} not found on list ${opts.list_id}` };
  row.owner_cell = opts.phone.trim();
  row.owner_cell_source = opts.source || 'people_search';
  if (opts.line_type) row.phone_line_type = opts.line_type;
  else if (!row.phone_line_type) row.phone_line_type = 'mobile';
  applyDial(row);
  const persistError = await persistRows([row]);
  return {
    ok: !persistError,
    error: persistError,
    ...supabaseTargetMeta(),
    lead_id: row.lead_id,
    company_name: row.company_name,
    owner_cell: row.owner_cell,
    dial_status: row.dial_status,
    assistant_instructions: 'Saved. Do not repeat other numbers from the people-search page.',
  };
}
