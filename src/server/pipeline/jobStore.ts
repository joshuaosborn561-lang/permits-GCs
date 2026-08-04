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
