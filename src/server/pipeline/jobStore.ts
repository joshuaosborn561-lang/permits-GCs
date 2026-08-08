import { randomUUID } from 'crypto';
import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import {
  emptyProgress,
  type ContactRecord,
  type CostEstimate,
  type ParsedQueryParams,
  type PropertyRecord,
  type RunProgress,
  type RunStatus,
} from '../types.js';

export interface RunJob {
  id: string;
  created_at: string;
  updated_at: string;
  natural_language_query: string;
  parsed_params: ParsedQueryParams;
  status: RunStatus;
  current_step: string | null;
  progress: RunProgress;
  total_records: number;
  total_cost_estimate: number;
  total_cost_actual: number;
  cost_estimate_detail: CostEstimate | null;
  cost_breakdown: Record<string, number>;
  error_message: string | null;
  properties: PropertyRecord[];
  contacts: ContactRecord[];
}

const memory = new Map<string, RunJob>();

export function createRun(opts: {
  query: string;
  params: ParsedQueryParams;
  estimate: CostEstimate;
}): RunJob {
  const now = new Date().toISOString();
  const job: RunJob = {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    natural_language_query: opts.query,
    parsed_params: opts.params,
    status: 'awaiting_confirmation',
    current_step: null,
    progress: emptyProgress(),
    total_records: 0,
    total_cost_estimate: opts.estimate.total_high,
    total_cost_actual: 0,
    cost_estimate_detail: opts.estimate,
    cost_breakdown: {},
    error_message: null,
    properties: [],
    contacts: [],
  };
  memory.set(job.id, job);
  void persistRun(job);
  return job;
}

export function getRun(id: string): RunJob | undefined {
  return memory.get(id);
}

export function listRuns(): RunJob[] {
  return [...memory.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Put a hydrated job into the in-memory store (used when resuming from Supabase). */
export function putRun(job: RunJob): RunJob {
  memory.set(job.id, job);
  return job;
}

/**
 * Load a run + properties from Supabase into memory so the pipeline can resume
 * after a process restart.
 */
export async function loadRunFromSupabase(runId: string): Promise<RunJob | null> {
  if (!hasSupabase()) return null;
  const { data, error } = await getSupabase().rpc('fetch_pmf_run_bundle', {
    p_secret: ingestSecret(),
    p_run_id: runId,
  });
  if (error) {
    console.warn('[supabase] fetch_pmf_run_bundle', error.message);
    throw new Error(error.message);
  }
  const bundle = data as {
    ok?: boolean;
    error?: string;
    run?: Record<string, unknown>;
    properties?: Record<string, unknown>[];
    contacts?: Record<string, unknown>[];
  };
  if (!bundle?.ok || !bundle.run) return null;

  const r = bundle.run;
  const properties: PropertyRecord[] = (bundle.properties ?? []).map((p) => ({
    id: String(p.id),
    run_id: String(p.run_id),
    address: (p.address as string) ?? null,
    city: (p.city as string) ?? null,
    state: (p.state as string) ?? null,
    zip: (p.zip as string) ?? null,
    latitude: (p.latitude as number) ?? null,
    longitude: (p.longitude as number) ?? null,
    building_name: (p.building_name as string) ?? null,
    owner_entity_name: (p.owner_entity_name as string) ?? null,
    owner_type: (p.owner_type as PropertyRecord['owner_type']) ?? null,
    care_of_company: (p.care_of_company as string) ?? null,
    is_likely_self_managed: (p.is_likely_self_managed as boolean) ?? null,
    property_manager_company: (p.property_manager_company as string) ?? null,
    pm_confidence: (p.pm_confidence as PropertyRecord['pm_confidence']) ?? null,
    pm_source: (p.pm_source as string) ?? null,
    mailing_address_raw: (p.mailing_address_raw as string) ?? null,
    status: String(p.status ?? 'pending'),
    raw_propwire_data: p.raw_propwire_data,
    raw_loopnet_data: p.raw_loopnet_data === null ? undefined : p.raw_loopnet_data,
    raw_google_data: p.raw_google_data === null ? undefined : p.raw_google_data,
  }));

  let contactRows = bundle.contacts ?? [];
  if (!contactRows.length) {
    const { data: cdata, error: cerr } = await getSupabase().rpc('fetch_pmf_contacts', {
      p_secret: ingestSecret(),
      p_run_id: runId,
    });
    if (!cerr && cdata && typeof cdata === 'object') {
      contactRows = ((cdata as { contacts?: Record<string, unknown>[] }).contacts ?? []) as Record<
        string,
        unknown
      >[];
    }
  }

  const contacts: ContactRecord[] = contactRows.map((c) => ({
    id: String(c.id),
    property_id: String(c.property_id),
    run_id: String(c.run_id),
    property_manager_company: String(c.property_manager_company ?? ''),
    contact_name: (c.contact_name as string) ?? null,
    contact_title: (c.contact_title as string) ?? null,
    contact_email: (c.contact_email as string) ?? null,
    contact_phone: (c.contact_phone as string) ?? null,
    source: (c.source as ContactRecord['source']) ?? 'getleads',
    match_confidence: (c.match_confidence as string) ?? null,
  }));

  const progress = {
    ...emptyProgress(),
    ...((r.progress as RunProgress) ?? {}),
  };

  const job: RunJob = {
    id: String(r.id),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    natural_language_query: String(r.natural_language_query ?? ''),
    parsed_params: (r.parsed_params as ParsedQueryParams) ?? ({} as ParsedQueryParams),
    status: (r.status as RunStatus) ?? 'running',
    current_step: (r.current_step as string) ?? null,
    progress,
    total_records: Number(r.total_records ?? properties.length),
    total_cost_estimate: Number(r.total_cost_estimate ?? 0),
    total_cost_actual: Number(r.total_cost_actual ?? 0),
    cost_estimate_detail: null,
    cost_breakdown: (r.cost_breakdown as Record<string, number>) ?? {},
    error_message: (r.error_message as string) ?? null,
    properties,
    contacts,
  };
  memory.set(job.id, job);
  return job;
}

export function updateRun(id: string, patch: Partial<RunJob>): RunJob {
  const job = memory.get(id);
  if (!job) throw new Error(`Run ${id} not found`);
  Object.assign(job, patch, { updated_at: new Date().toISOString() });
  memory.set(id, job);
  void persistRun(job);
  return job;
}

export function publicRunView(job: RunJob) {
  return {
    id: job.id,
    created_at: job.created_at,
    updated_at: job.updated_at,
    natural_language_query: job.natural_language_query,
    parsed_params: job.parsed_params,
    status: job.status,
    current_step: job.current_step,
    progress: job.progress,
    total_records: job.total_records,
    total_cost_estimate: job.total_cost_estimate,
    total_cost_actual: job.total_cost_actual,
    cost_estimate_detail: job.cost_estimate_detail,
    cost_breakdown: job.cost_breakdown,
    error_message: job.error_message,
    property_count: job.properties.length,
    contact_count: job.contacts.length,
  };
}

async function persistRun(job: RunJob): Promise<void> {
  if (!hasSupabase()) return;
  try {
    const { error } = await getSupabase().rpc('ingest_pmf_run', {
      p_secret: ingestSecret(),
      p_run: {
        id: job.id,
        created_at: job.created_at,
        updated_at: job.updated_at,
        natural_language_query: job.natural_language_query,
        parsed_params: job.parsed_params,
        status: job.status,
        current_step: job.current_step,
        progress: job.progress,
        total_records: job.total_records,
        total_cost_estimate: job.total_cost_estimate,
        total_cost_actual: job.total_cost_actual,
        cost_breakdown: job.cost_breakdown,
        error_message: job.error_message,
      },
    });
    if (error) console.warn('[supabase] ingest_pmf_run', error.message);
  } catch (err) {
    console.warn('[supabase] persist run failed', err);
  }
}

export async function persistProperties(runId: string, properties: PropertyRecord[]): Promise<void> {
  if (!hasSupabase() || !properties.length) return;
  try {
    const rows = properties.map((p) => ({
      id: p.id,
      run_id: runId,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      latitude: p.latitude,
      longitude: p.longitude,
      building_name: p.building_name,
      owner_entity_name: p.owner_entity_name,
      owner_type: p.owner_type,
      care_of_company: p.care_of_company,
      is_likely_self_managed: p.is_likely_self_managed,
      property_manager_company: p.property_manager_company,
      pm_confidence: p.pm_confidence,
      pm_source: p.pm_source,
      mailing_address_raw: p.mailing_address_raw,
      status: p.status,
      raw_propwire_data: p.raw_propwire_data ?? null,
      raw_loopnet_data: p.raw_loopnet_data ?? null,
      raw_google_data: p.raw_google_data ?? null,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await getSupabase().rpc('ingest_pmf_properties', {
        p_secret: ingestSecret(),
        p_rows: chunk,
      });
      if (error) console.warn('[supabase] ingest_pmf_properties', error.message);
    }
  } catch (err) {
    console.warn('[supabase] persist properties failed', err);
  }
}

export async function persistContacts(contacts: ContactRecord[]): Promise<void> {
  if (!hasSupabase() || !contacts.length) return;
  try {
    for (let i = 0; i < contacts.length; i += 100) {
      const chunk = contacts.slice(i, i + 100);
      const { error } = await getSupabase().rpc('ingest_pmf_contacts', {
        p_secret: ingestSecret(),
        p_rows: chunk,
      });
      if (error) console.warn('[supabase] ingest_pmf_contacts', error.message);
    }
  } catch (err) {
    console.warn('[supabase] persist contacts failed', err);
  }
}
