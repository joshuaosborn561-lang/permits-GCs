import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import type { RunJob } from '../pipeline/jobStore.js';
import type { ContactRecord, PropertyRecord } from '../types.js';

/**
 * Mirror completed PM-finder contacts into public.scrape_jobs / public.scrape_leads
 * using the same ingest RPCs + SUPABASE_INGEST_SECRET as the Google Maps scraper.
 */
export async function syncContactsToScrapeLeads(job: RunJob): Promise<number> {
  if (!hasSupabase() || !job.contacts.length) return 0;

  const sb = getSupabase();
  const secret = ingestSecret();
  const scrapeJobId = `pmf-${job.id}`;
  const locationTag = job.parsed_params.location_value.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const tags = ['property_pm_finder', 'commercial', locationTag].filter(Boolean);
  const now = new Date().toISOString();

  const { error: jobErr } = await sb.rpc('ingest_scrape_job', {
    p_secret: secret,
    p_job: {
      id: scrapeJobId,
      prompt: job.natural_language_query,
      tags,
      // Sync runs at end of a successful pipeline, before outer status flip.
      status: 'completed',
      estimate: {
        total: job.total_cost_actual || job.total_cost_estimate || 0,
        mapsCost: 0,
        llmCost: Number(job.cost_breakdown.openai_parse ?? 0),
        apifyCost: Number(
          (job.cost_breakdown.propwire ?? 0) +
            (job.cost_breakdown.loopnet ?? 0) +
            (job.cost_breakdown.google_pm ?? 0),
        ),
        requestEstimate: job.total_records || job.contacts.length,
      },
      downloadUrl: `/api/runs/${job.id}/export.csv`,
      error: job.error_message,
      createdAt: job.created_at,
      finishedAt: now,
    },
  });

  if (jobErr) {
    console.warn('[scrape_leads sync] ingest_scrape_job failed', jobErr.message);
    return 0;
  }

  const propsById = new Map(job.properties.map((p) => [p.id, p]));
  const rows = job.contacts.map((c) =>
    toIngestRow(c, propsById.get(c.property_id)),
  );

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await sb.rpc('ingest_scrape_leads', {
      p_secret: secret,
      p_job_id: scrapeJobId,
      p_tags: tags,
      p_rows: chunk,
    });
    if (error) {
      console.warn('[scrape_leads sync] ingest_scrape_leads failed', error.message);
      break;
    }
    inserted += Number((data as { inserted?: number } | null)?.inserted ?? chunk.length);
  }

  console.log(`[scrape_leads sync] dumped ${inserted} contacts under job ${scrapeJobId}`);
  return inserted;
}

function toIngestRow(contact: ContactRecord, property?: PropertyRecord) {
  return {
    place_id: property?.address ? `pmf-addr:${property.address}` : '',
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
