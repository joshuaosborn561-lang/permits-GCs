import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import type { RunJob } from '../pipeline/jobStore.js';
import type { ContactRecord, PropertyRecord } from '../types.js';

export interface SyncToSupabaseResult {
  ok: boolean;
  supabase_configured: boolean;
  run_id: string;
  scrape_job_id: string;
  mode: 'contacts' | 'properties_fallback' | 'empty';
  counts: {
    properties_in_run: number;
    contacts_in_run: number;
    property_pm_finder_properties_upserted: number;
    property_pm_finder_contacts_upserted: number;
    scrape_leads_deleted: number;
    scrape_leads_inserted: number;
    scrape_export_bytes: number;
    contacts_by_source: Record<string, number>;
  };
  /** SQL Claude/user should run to verify — counts only, no row dump. */
  verify_sql: string[];
  error?: string;
}

function scrapeJobIdFor(runId: string): string {
  return `pmf-${runId}`;
}

function locationTags(job: RunJob): string[] {
  const locationTag = job.parsed_params.location_value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
  return ['property_pm_finder', 'commercial', locationTag].filter(Boolean);
}

function countBySource(contacts: ContactRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of contacts) {
    out[c.source] = (out[c.source] || 0) + 1;
  }
  return out;
}

function contactToIngestRow(contact: ContactRecord, property?: PropertyRecord) {
  return {
    place_id: property?.address ? `pmf-addr:${property.address}` : `pmf-contact:${contact.id}`,
    name: contact.contact_name ?? '',
    owner_name: property?.owner_entity_name ?? contact.property_manager_company ?? '',
    email: contact.contact_email ?? '',
    phone: contact.contact_phone ?? '',
    website: '',
    city: property?.city ?? '',
    state: property?.state ?? '',
    zip: property?.zip ?? '',
    rating: '',
    reviews: '',
    category: contact.property_manager_company || 'Commercial Property Manager',
    main_category: contact.property_manager_company || 'Commercial Property Manager',
    maps_url: '',
    in_icp: contact.contact_email ? 'true' : 'false',
    contact_title: contact.contact_title ?? '',
    contact_source: contact.source,
    pm_confidence: property?.pm_confidence ?? '',
    pm_source: property?.pm_source ?? '',
    address: property?.address ?? '',
    source_pipeline: 'property_pm_finder',
  };
}

function propertyToIngestRow(property: PropertyRecord) {
  return {
    place_id: property.address ? `pmf-addr:${property.address}` : `pmf-prop:${property.id}`,
    name: property.property_manager_company || property.owner_entity_name || '',
    owner_name: property.owner_entity_name ?? '',
    email: '',
    phone: '',
    website: '',
    city: property.city ?? '',
    state: property.state ?? '',
    zip: property.zip ?? '',
    rating: '',
    reviews: '',
    category: property.property_manager_company || 'Commercial Property Owner',
    main_category: 'Commercial Property Owner',
    maps_url: '',
    in_icp: 'false',
    contact_title: '',
    contact_source: '',
    pm_confidence: property.pm_confidence ?? '',
    pm_source: property.pm_source ?? '',
    address: property.address ?? '',
    source_pipeline: 'property_pm_finder',
  };
}

function contactsToCsv(job: RunJob): string {
  const headers = [
    'contact_name',
    'contact_title',
    'contact_email',
    'contact_phone',
    'contact_source',
    'property_manager_company',
    'owner_entity_name',
    'address',
    'city',
    'state',
    'zip',
    'pm_confidence',
    'pm_source',
  ];
  const propsById = new Map(job.properties.map((p) => [p.id, p]));
  const esc = (v: string | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  if (job.contacts.length) {
    for (const c of job.contacts) {
      const p = propsById.get(c.property_id);
      lines.push(
        [
          c.contact_name,
          c.contact_title,
          c.contact_email,
          c.contact_phone,
          c.source,
          c.property_manager_company,
          p?.owner_entity_name ?? '',
          p?.address ?? '',
          p?.city ?? '',
          p?.state ?? '',
          p?.zip ?? '',
          p?.pm_confidence ?? '',
          p?.pm_source ?? '',
        ]
          .map((x) => esc(x as string))
          .join(','),
      );
    }
  } else {
    for (const p of job.properties) {
      lines.push(
        [
          '',
          '',
          '',
          '',
          '',
          p.property_manager_company ?? '',
          p.owner_entity_name ?? '',
          p.address ?? '',
          p.city ?? '',
          p.state ?? '',
          p.zip ?? '',
          p.pm_confidence ?? '',
          p.pm_source ?? '',
        ]
          .map((x) => esc(x))
          .join(','),
      );
    }
  }
  return lines.join('\n');
}

/**
 * Mirror a PM-finder run into:
 * - property_pm_finder.* (via caller persist, or already persisted)
 * - public.scrape_jobs / public.scrape_leads / public.scrape_exports
 *
 * Same ingest-secret RPC pattern as the Google Maps scraper Railway UI.
 * Returns **counts only** — never row payloads for model context.
 */
export async function syncContactsToScrapeLeads(job: RunJob): Promise<number> {
  const result = await syncRunToScrapeLeads(job);
  return result.counts.scrape_leads_inserted;
}

export async function syncRunToScrapeLeads(job: RunJob): Promise<SyncToSupabaseResult> {
  const scrapeJobId = scrapeJobIdFor(job.id);
  const bySource = countBySource(job.contacts);
  const verifySql = [
    `select count(*) from property_pm_finder.properties where run_id = '${job.id}';`,
    `select count(*) from property_pm_finder.contacts where run_id = '${job.id}';`,
    `select count(*) from public.scrape_leads where job_id = '${scrapeJobId}';`,
    `select source, count(*) from property_pm_finder.contacts where run_id = '${job.id}' group by 1;`,
  ];

  const base: SyncToSupabaseResult = {
    ok: false,
    supabase_configured: hasSupabase(),
    run_id: job.id,
    scrape_job_id: scrapeJobId,
    mode: job.contacts.length ? 'contacts' : job.properties.length ? 'properties_fallback' : 'empty',
    counts: {
      properties_in_run: job.properties.length,
      contacts_in_run: job.contacts.length,
      property_pm_finder_properties_upserted: 0,
      property_pm_finder_contacts_upserted: 0,
      scrape_leads_deleted: 0,
      scrape_leads_inserted: 0,
      scrape_export_bytes: 0,
      contacts_by_source: bySource,
    },
    verify_sql: verifySql,
  };

  if (!hasSupabase()) {
    return { ...base, error: 'Supabase not configured' };
  }

  const sb = getSupabase();
  const secret = ingestSecret();
  const tags = locationTags(job);
  const now = new Date().toISOString();

  const { error: jobErr } = await sb.rpc('ingest_scrape_job', {
    p_secret: secret,
    p_job: {
      id: scrapeJobId,
      prompt: job.natural_language_query,
      tags,
      status: job.status === 'failed' ? 'failed' : 'completed',
      estimate: {
        total: job.total_cost_actual || job.total_cost_estimate || 0,
        mapsCost: 0,
        llmCost: Number(job.cost_breakdown.openai_parse ?? 0),
        apifyCost: Number(
          (job.cost_breakdown.propwire ?? 0) +
            (job.cost_breakdown.loopnet ?? 0) +
            (job.cost_breakdown.google_pm ?? 0),
        ),
        requestEstimate: job.total_records || job.contacts.length || job.properties.length,
      },
      downloadUrl: `/api/runs/${job.id}/export.csv`,
      error: job.error_message,
      createdAt: job.created_at,
      finishedAt: now,
    },
  });

  if (jobErr) {
    console.warn('[sync_to_supabase] ingest_scrape_job failed', jobErr.message);
    return { ...base, error: jobErr.message };
  }

  const propsById = new Map(job.properties.map((p) => [p.id, p]));
  const rows = job.contacts.length
    ? job.contacts.map((c) => contactToIngestRow(c, propsById.get(c.property_id)))
    : job.properties.map(propertyToIngestRow);

  // replace_scrape_leads is idempotent (delete+insert). Chunk large payloads.
  let deleted = 0;
  let inserted = 0;
  if (!rows.length) {
    const { data, error } = await sb.rpc('replace_scrape_leads', {
      p_secret: secret,
      p_job_id: scrapeJobId,
      p_tags: tags,
      p_rows: [],
    });
    if (error) {
      return { ...base, error: error.message };
    }
    deleted = Number((data as { deleted?: number } | null)?.deleted ?? 0);
  } else {
    // First chunk replaces; subsequent chunks append via ingest_scrape_leads
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      if (i === 0) {
        const { data, error } = await sb.rpc('replace_scrape_leads', {
          p_secret: secret,
          p_job_id: scrapeJobId,
          p_tags: tags,
          p_rows: chunk,
        });
        if (error) {
          console.warn('[sync_to_supabase] replace_scrape_leads failed', error.message);
          return { ...base, error: error.message };
        }
        deleted = Number((data as { deleted?: number } | null)?.deleted ?? 0);
        inserted += Number((data as { inserted?: number } | null)?.inserted ?? chunk.length);
      } else {
        const { data, error } = await sb.rpc('ingest_scrape_leads', {
          p_secret: secret,
          p_job_id: scrapeJobId,
          p_tags: tags,
          p_rows: chunk,
        });
        if (error) {
          console.warn('[sync_to_supabase] ingest_scrape_leads failed', error.message);
          return {
            ...base,
            ok: false,
            counts: {
              ...base.counts,
              scrape_leads_deleted: deleted,
              scrape_leads_inserted: inserted,
            },
            error: error.message,
          };
        }
        inserted += Number((data as { inserted?: number } | null)?.inserted ?? chunk.length);
      }
    }
  }

  const csv = contactsToCsv(job);
  const { error: exportErr } = await sb.rpc('upsert_scrape_export', {
    p_secret: secret,
    p_job_id: scrapeJobId,
    p_filename: `pmf-${job.id}.csv`,
    p_content: csv,
  });
  if (exportErr) {
    console.warn('[sync_to_supabase] upsert_scrape_export failed', exportErr.message);
  }

  console.log(
    `[sync_to_supabase] run=${job.id} job=${scrapeJobId} mode=${base.mode} leads=${inserted} (deleted ${deleted})`,
  );

  return {
    ...base,
    ok: true,
    counts: {
      ...base.counts,
      scrape_leads_deleted: deleted,
      scrape_leads_inserted: inserted,
      scrape_export_bytes: exportErr ? 0 : Buffer.byteLength(csv, 'utf8'),
    },
  };
}

/** Count-only verification against Supabase (no row payloads). */
export async function countPmSync(runId: string): Promise<Record<string, unknown>> {
  if (!hasSupabase()) {
    return { ok: false, error: 'Supabase not configured' };
  }
  const { data, error } = await getSupabase().rpc('count_pmf_sync', {
    p_secret: ingestSecret(),
    p_run_id: runId,
  });
  if (error) return { ok: false, error: error.message };
  return (data as Record<string, unknown>) ?? { ok: false, error: 'empty response' };
}
