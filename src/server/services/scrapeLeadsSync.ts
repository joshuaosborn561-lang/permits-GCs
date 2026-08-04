import { getSupabase, hasSupabase } from '../lib/supabase.js';
import type { RunJob } from '../pipeline/jobStore.js';
import type { ContactRecord, PropertyRecord } from '../types.js';

/**
 * Mirror completed PM-finder contacts into public.scrape_jobs / public.scrape_leads
 * on the google-maps-scraper-leads Supabase project so they sit beside Maps scrapes.
 */
export async function syncContactsToScrapeLeads(job: RunJob): Promise<number> {
  if (!hasSupabase() || !job.contacts.length) return 0;

  const sb = getSupabase();
  const publicDb = sb.schema('public');
  const scrapeJobId = `pmf-${job.id}`;
  const locationTag = job.parsed_params.location_value.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const now = new Date().toISOString();

  const { error: jobErr } = await publicDb.from('scrape_jobs').upsert(
    {
      id: scrapeJobId,
      prompt: job.natural_language_query,
      tags: ['property_pm_finder', 'commercial', locationTag].filter(Boolean),
      status: job.status === 'completed' ? 'completed' : job.status,
      estimate_total: job.total_cost_actual || job.total_cost_estimate || 0,
      estimate_maps: 0,
      estimate_llm: Number(job.cost_breakdown.openai_parse ?? 0),
      estimate_apify: Number(
        (job.cost_breakdown.propwire ?? 0) +
          (job.cost_breakdown.loopnet ?? 0) +
          (job.cost_breakdown.google_pm ?? 0),
      ),
      request_estimate: job.total_records || job.contacts.length,
      download_url: `/api/runs/${job.id}/export.csv`,
      error: job.error_message,
      created_at: job.created_at,
      finished_at: now,
    },
    { onConflict: 'id' },
  );

  if (jobErr) {
    console.warn('[scrape_leads sync] scrape_jobs upsert failed', jobErr.message);
    return 0;
  }

  // Avoid duplicate dumps if the same run is synced twice
  await publicDb.from('scrape_leads').delete().eq('job_id', scrapeJobId);

  const propsById = new Map(job.properties.map((p) => [p.id, p]));
  const rows = job.contacts.map((c) => toScrapeLeadRow(scrapeJobId, c, propsById.get(c.property_id)));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error, count } = await publicDb.from('scrape_leads').insert(chunk, { count: 'exact' });
    if (error) {
      console.warn('[scrape_leads sync] insert failed', error.message);
      break;
    }
    inserted += count ?? chunk.length;
  }

  console.log(`[scrape_leads sync] dumped ${inserted} contacts under job ${scrapeJobId}`);
  return inserted;
}

function toScrapeLeadRow(
  scrapeJobId: string,
  contact: ContactRecord,
  property?: PropertyRecord,
) {
  return {
    job_id: scrapeJobId,
    tags: [
      'property_pm_finder',
      'commercial',
      contact.source,
      property?.pm_confidence,
      property?.pm_source,
    ].filter((t): t is string => Boolean(t)),
    place_id: property?.address ? `pmf-addr:${property.address}` : null,
    name: contact.contact_name,
    owner_name: property?.owner_entity_name ?? contact.property_manager_company,
    email: contact.contact_email,
    phone: contact.contact_phone,
    website: null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    zip: property?.zip ?? null,
    rating: null,
    reviews: null,
    category: contact.property_manager_company || 'Commercial Property Manager',
    maps_url: null,
    in_icp: Boolean(contact.contact_email),
    raw: {
      source_pipeline: 'property_pm_finder',
      contact,
      property: property
        ? {
            id: property.id,
            address: property.address,
            owner_entity_name: property.owner_entity_name,
            owner_type: property.owner_type,
            care_of_company: property.care_of_company,
            property_manager_company: property.property_manager_company,
            pm_confidence: property.pm_confidence,
            pm_source: property.pm_source,
            building_name: property.building_name,
          }
        : null,
    },
  };
}
