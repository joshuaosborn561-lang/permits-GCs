import { randomUUID } from 'node:crypto';
import { nationalChainHit } from '../lib/nationalChain.js';
import {
  hasShovelsApi,
  pullContractorsForGeo,
  resolveShovelsGeo,
  type ShovelsApiContractor,
} from '../lib/shovels.js';
import { supabaseTargetMeta } from '../lib/supabaseTarget.js';
import { hasSupabase, SCHEMA } from '../lib/supabase.js';
import { upsertCallingListMeta } from './callingLists.js';
import { resolveGeoTargets } from './shovelsGeoTargets.js';
import { estimateShovelsCredits } from './shovelsCredits.js';
import { contractorsToCsv, type ShovelsContractor } from './shovelsContractors.js';
import { replaceLeads, upsertExport, upsertJob } from './syncToSupabase.js';

const DEFAULT_MAX_RECORDS = 1500;
const HARD_MAX_RECORDS = 8000;

export interface PullShovelsCallingListInput {
  geos?: string;
  place?: string;
  city?: string;
  state?: string;
  date_from?: string;
  date_to?: string;
  property_type?: string;
  page_size?: number;
  max_records?: number;
  has_phone?: boolean;
  has_email?: boolean;
  exclude_national_chains?: boolean;
  min_permit_count?: number;
  max_permit_count?: number;
  name?: string;
  owner?: string;
  /** Must be true to spend Shovels credits on a live pull. */
  confirm?: boolean;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultWindow() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { date_from: isoDate(from), date_to: isoDate(to) };
}

function hasContact(v: string | null | undefined): boolean {
  return Boolean(v && String(v).trim());
}

function toContractor(c: ShovelsApiContractor): ShovelsContractor {
  return {
    id: c.id,
    name: c.name,
    business_name: c.business_name,
    dba: c.dba,
    phone: c.phone,
    primary_phone: c.primary_phone,
    email: c.email,
    primary_email: c.primary_email,
    website: c.website,
    linkedin_url: c.linkedin_url,
    employee_count: c.employee_count,
    address_street: c.address_street,
    address_city: c.address_city,
    address_state: c.address_state,
    address_zip: c.address_zip,
    places: c.places,
    permit_count: c.permit_count,
    total_job_value: c.total_job_value,
    primary_industry: c.primary_industry,
    business_type: c.business_type,
  };
}

function applyFilters(
  items: ShovelsApiContractor[],
  opts: PullShovelsCallingListInput,
): ShovelsApiContractor[] {
  return items.filter((c) => {
    if (opts.has_phone === true && !hasContact(c.phone) && !hasContact(c.primary_phone)) return false;
    if (opts.has_email === true && !hasContact(c.email) && !hasContact(c.primary_email)) return false;
    if (opts.min_permit_count != null && (c.permit_count ?? 0) < opts.min_permit_count) return false;
    if (opts.max_permit_count != null && (c.permit_count ?? 0) > opts.max_permit_count) return false;
    if (opts.exclude_national_chains === true && nationalChainHit(c).national_chain) return false;
    return true;
  });
}

function slugOwner(owner: string): string {
  return owner.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'shared';
}

/**
 * Live Shovels pull for any US geo (East/West coast metros, cities, counties, state codes).
 * Without confirm=true, returns a credit estimate only.
 */
export async function pullShovelsCallingList(opts: PullShovelsCallingListInput = {}) {
  const targets = resolveGeoTargets(opts);
  const maxRecords = Math.min(
    HARD_MAX_RECORDS,
    Math.max(1, opts.max_records ?? DEFAULT_MAX_RECORDS),
  );
  const window = {
    date_from: opts.date_from || defaultWindow().date_from,
    date_to: opts.date_to || defaultWindow().date_to,
  };
  const propertyType = opts.property_type || 'commercial';
  const owner = slugOwner(opts.owner || 'cayden');
  const geoLabel = targets.map((t) => t.place).join('+');
  const name =
    opts.name?.trim() ||
    `Shovels live · ${geoLabel.replace(/_/g, ' ')} · ${owner}`;

  if (!hasShovelsApi()) {
    return {
      ok: false,
      error: 'No Shovels API key. Cayden can set one with shovels_set_api_key (confirm=true).',
      ...supabaseTargetMeta(),
    };
  }

  if (opts.confirm !== true) {
    const estimate = await estimateShovelsCredits({
      geos: opts.geos,
      place: opts.place,
      city: opts.city,
      state: opts.state,
      date_from: window.date_from,
      date_to: window.date_to,
      property_type: propertyType,
      page_size: opts.page_size ?? 100,
      max_records: maxRecords,
    });
    return {
      ok: true,
      needs_confirm: true,
      confirm_required: true,
      action: 'shovels_pull_calling_list',
      targets,
      max_records: maxRecords,
      proposed_list_name: name,
      owner,
      estimate,
      assistant_instructions:
        'Show BOTH free_tier_pages and paid_tier_companies. There is NO timezone or TX-only restriction — East/West coast and any US city/county/state work. Re-call shovels_pull_calling_list with the same geos and confirm=true to spend credits and write the calling list. Prefer exclude_national_chains=true and has_phone=true when Cayden wants dialable locals.',
    };
  }

  if (!hasSupabase()) {
    return { ok: false, error: 'Supabase not configured', ...supabaseTargetMeta() };
  }

  const byId = new Map<string, ShovelsApiContractor>();
  const perGeo: Array<Record<string, unknown>> = [];
  let pages = 0;
  let creditsSpent = 0;
  let anyTruncated = false;

  for (const t of targets) {
    const remaining = maxRecords - byId.size;
    if (remaining <= 0) {
      anyTruncated = true;
      break;
    }
    const geo = await resolveShovelsGeo({
      kind: t.kind,
      q: t.q,
      state: t.state,
    });
    const pulled = await pullContractorsForGeo({
      geo,
      place: t.place,
      permit_from: window.date_from,
      permit_to: window.date_to,
      property_type: propertyType,
      page_size: opts.page_size ?? 100,
      max_records: remaining,
    });
    pages += pulled.pages;
    creditsSpent += pulled.credits_spent;
    if (pulled.truncated) anyTruncated = true;
    let added = 0;
    for (const item of pulled.items) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, item);
      added += 1;
    }
    perGeo.push({
      place: t.place,
      requested: t,
      geo,
      fetched: pulled.items.length,
      unique_added: added,
      pages: pulled.pages,
      truncated: pulled.truncated,
    });
  }

  const filtered = applyFilters([...byId.values()], opts);
  const contractors = filtered.map(toContractor);
  const jobId = `permit-live-${randomUUID().slice(0, 8)}`;
  const tags = [
    'permit_parcel',
    'calling_list',
    'shovels_live',
    `owner:${owner}`,
    geoLabel.slice(0, 80),
  ].filter(Boolean);

  const jobErr = await upsertJob({
    id: jobId,
    prompt: name,
    tags,
    requestEstimate: contractors.length,
  });
  if (jobErr) return { ok: false, error: jobErr, ...supabaseTargetMeta() };

  const leads = contractors.map((c) => {
    const chain = nationalChainHit(c);
    return {
      place_id: `shovels:${c.id}`,
      name: c.business_name || c.name || '',
      owner_name: c.name || '',
      email: c.email || c.primary_email || '',
      phone: c.phone || c.primary_phone || '',
      website: c.website || '',
      city: c.address_city || '',
      state: c.address_state || '',
      zip: c.address_zip || '',
      rating: '',
      reviews: c.permit_count != null ? String(c.permit_count) : '',
      permit_count: c.permit_count,
      total_job_value: c.total_job_value,
      national_chain: chain.national_chain ? 'true' : 'false',
      national_chain_reason: chain.reason || '',
      category: c.primary_industry || 'commercial_contractor',
      main_category: 'shovels_live_contractor',
      maps_url: '',
      in_icp: c.email || c.primary_email || c.phone || c.primary_phone ? 'true' : 'false',
      address: c.address_street || '',
      places: (c.places || []).join('|'),
      source_pipeline: 'permit_parcel_shovels_live',
    };
  });

  const { deleted, inserted, error } = await replaceLeads(jobId, tags, leads);
  if (error) return { ok: false, error, ...supabaseTargetMeta() };

  const exportBytes = await upsertExport(jobId, `${jobId}.csv`, contractorsToCsv(contractors));
  const metaErr = await upsertCallingListMeta({
    id: jobId,
    name,
    owner,
    source: 'shovels_live',
    filters: {
      geos: opts.geos ?? null,
      place: opts.place ?? null,
      city: opts.city ?? null,
      state: opts.state ?? null,
      targets,
      window,
      property_type: propertyType,
      max_records: maxRecords,
      has_phone: opts.has_phone ?? null,
      has_email: opts.has_email ?? null,
      exclude_national_chains: opts.exclude_national_chains ?? null,
    },
    row_count: inserted,
  });
  if (metaErr) {
    return {
      ok: false,
      error: `Leads wrote but calling-list catalog failed: ${metaErr}`,
      list_id: jobId,
      ...supabaseTargetMeta(),
    };
  }

  return {
    ok: true,
    ...supabaseTargetMeta(),
    supabase_schema: SCHEMA,
    list: { id: jobId, name, owner, source: 'shovels_live', row_count: inserted },
    rows_inserted: inserted,
    rows_deleted: deleted,
    unique_before_filters: byId.size,
    unique_after_filters: contractors.length,
    pages_fetched: pages,
    credits_spent_approx: creditsSpent,
    truncated: anyTruncated,
    max_records: maxRecords,
    per_geo: perGeo,
    export_bytes: exportBytes,
    window: { ...window, property_type: propertyType },
    assistant_instructions:
      'Live Shovels list is in Supabase — any US geo is allowed (no timezone / TX-only gate). Tell Cayden the list id. Filter with query_calling_list. Score / enrich as usual. Do not dump rows into chat.',
  };
}
