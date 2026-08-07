import { config } from '../config.js';
import { addCost, round6 } from '../lib/costs.js';
import { geocodeLocation } from '../lib/geocode.js';
import {
  contactToRecord,
  enrichPmCompany,
  type CachedContact,
} from '../services/contactEnrichment.js';
import { resolveViaGoogle } from '../services/googleSearch.js';
import { resolveManyViaLoopnet } from '../services/loopnet.js';
import { isNameVariant, parseOwnerMailing } from '../services/ownerParse.js';
import { pullPropwire } from '../services/propwire.js';
import type { GeocodedLocation, PropertyRecord, RunProgress } from '../types.js';
import { syncContactsToScrapeLeads } from '../services/scrapeLeadsSync.js';
import {
  getRun,
  persistContacts,
  persistProperties,
  updateRun,
} from './jobStore.js';

export async function startPipeline(runId: string): Promise<void> {
  const job = getRun(runId);
  if (!job) throw new Error('Run not found');
  if (job.status === 'running') return;

  updateRun(runId, {
    status: 'running',
    current_step: 'geocoding',
    error_message: null,
  });

  try {
    await runPipeline(runId);
    updateRun(runId, {
      status: 'completed',
      current_step: 'done',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pipeline] failed', runId, message);
    updateRun(runId, {
      status: 'failed',
      current_step: 'failed',
      error_message: message,
    });
  }
}

async function runPipeline(runId: string): Promise<void> {
  const job = getRun(runId)!;
  const progress: RunProgress = { ...job.progress };
  let breakdown = { ...job.cost_breakdown };

  // Geocode
  updateRun(runId, { current_step: 'geocoding' });
  const geo = await geocodeLocation(job.parsed_params);

  // Step 1 — Propwire
  updateRun(runId, { current_step: 'step_1_propwire' });
  const pull = await pullPropwire({
    runId,
    params: job.parsed_params,
    geo,
  });

  if (pull.failed && !pull.properties.length) {
    progress.failed_step_1 = 1;
    updateProgress(runId, progress, breakdown);
    throw new Error(`Propwire pull failed: ${pull.error ?? 'unknown error'}`);
  }

  let properties = pull.properties;
  progress.records_pulled = properties.length;
  ({ breakdown } = addCost(breakdown, 'propwire', pull.cost));
  progress.cost_breakdown = breakdown;
  progress.cost_actual = sumBreakdown(breakdown);
  updateRun(runId, {
    properties,
    total_records: properties.length,
    progress: { ...progress },
    total_cost_actual: progress.cost_actual,
    cost_breakdown: breakdown,
  });
  await persistProperties(runId, properties);

  // Step 2 — parse c/o
  updateRun(runId, { current_step: 'step_2_parse_owner' });
  const unresolvedAfterCo: PropertyRecord[] = [];

  for (const prop of properties) {
    const mailing = prop.mailing_address_raw || '';
    const parsed = await parseOwnerMailing({
      mailingAddress: mailing,
      ownerNameHint: prop.owner_entity_name,
      runId,
      propertyId: prop.id,
    });

    ({ breakdown } = addCost(breakdown, 'openai_parse', parsed.cost));

    prop.owner_entity_name = parsed.owner_entity_name || prop.owner_entity_name;
    prop.owner_type = parsed.owner_type;
    prop.care_of_company = parsed.care_of_company;
    prop.is_likely_self_managed = parsed.is_likely_self_managed;
    prop.status = 'parsed';

    if (
      parsed.care_of_company &&
      !isNameVariant(parsed.owner_entity_name, parsed.care_of_company)
    ) {
      prop.property_manager_company = parsed.care_of_company;
      prop.pm_confidence = 'high';
      prop.pm_source = 'c/o field';
      prop.status = 'pm_resolved';
      progress.resolved_co += 1;
    } else {
      unresolvedAfterCo.push(prop);
    }

    bumpCost(progress, breakdown);
    if ((progress.resolved_co + unresolvedAfterCo.length) % 10 === 0) {
      updateProgress(runId, progress, breakdown, properties);
    }
  }

  updateProgress(runId, progress, breakdown, properties);
  await persistProperties(runId, properties);

  await startPipelineFromOwnerParse({
    runId,
    properties,
    unresolvedAfterCo,
    progress,
    breakdown,
    geo,
  });
}

/**
 * Continue a run after Propwire + owner/c/o parse (or after loading those
 * results from Supabase). Used by resume.
 */
export async function startPipelineFromOwnerParse(opts: {
  runId: string;
  properties: PropertyRecord[];
  unresolvedAfterCo: PropertyRecord[];
  progress: RunProgress;
  breakdown: Record<string, number>;
  geo: GeocodedLocation;
  skipLoopnet?: boolean;
  skipGoogle?: boolean;
}): Promise<void> {
  const { runId, properties, unresolvedAfterCo, geo } = opts;
  let { progress, breakdown } = opts;

  // Step 3 — LoopNet (mode: off | batched | per_property)
  let stillUnresolved: PropertyRecord[] = [];
  if (opts.skipLoopnet) {
    stillUnresolved = [...unresolvedAfterCo];
  } else {
    updateRun(runId, {
      current_step:
        config.loopnetMode === 'off' ? 'step_3_loopnet_skipped' : 'step_3_loopnet',
    });

    if (unresolvedAfterCo.length) {
      const loopnetResults = await resolveManyViaLoopnet({
        properties: unresolvedAfterCo,
        runId,
        onProgress: (done, total) => {
          if (done === total || done % Math.max(1, config.loopnetBatchSize) === 0) {
            bumpCost(progress, breakdown);
            updateProgress(runId, progress, breakdown, properties);
          }
        },
      });

      for (const prop of unresolvedAfterCo) {
        const result = loopnetResults.get(prop.id);
        if (!result || result.skipped) {
          stillUnresolved.push(prop);
          continue;
        }
        ({ breakdown } = addCost(breakdown, 'loopnet', result.cost));
        prop.raw_loopnet_data = result.raw;

        if (result.found && result.property_manager_company) {
          prop.property_manager_company = result.property_manager_company;
          prop.pm_confidence = 'medium';
          prop.pm_source = 'LoopNet listing';
          prop.status = 'pm_resolved';
          progress.resolved_loopnet += 1;
        } else {
          stillUnresolved.push(prop);
        }
        bumpCost(progress, breakdown);
      }
    }

    updateProgress(runId, progress, breakdown, properties);
    await persistProperties(runId, properties);
  }

  // Step 4 — Google (hard cap)
  if (!opts.skipGoogle) {
    updateRun(runId, { current_step: 'step_4_google' });
    for (const prop of stillUnresolved) {
      if (progress.google_searches_used >= config.googleSearchHardCap) {
        prop.pm_confidence = 'unresolved';
        prop.pm_source = 'google search cap reached';
        prop.status = 'pm_unresolved';
        progress.google_cap_reached += 1;
        progress.unresolved += 1;
        continue;
      }

      const result = await resolveViaGoogle({ property: prop, runId });
      progress.google_searches_used += 1;
      ({ breakdown } = addCost(breakdown, 'google_pm', result.cost));
      prop.raw_google_data = result.raw;

      if (result.found && result.property_manager_company) {
        prop.property_manager_company = result.property_manager_company;
        prop.pm_confidence = 'low';
        prop.pm_source = 'Google search';
        prop.status = 'pm_resolved';
        progress.resolved_google += 1;
      } else {
        prop.pm_confidence = 'unresolved';
        prop.pm_source = null;
        prop.status = 'pm_unresolved';
        progress.unresolved += 1;
      }
      bumpCost(progress, breakdown);
      if (progress.google_searches_used % 5 === 0) {
        updateProgress(runId, progress, breakdown, properties);
      }
    }

    updateProgress(runId, progress, breakdown, properties);
    await persistProperties(runId, properties);
  } else {
    for (const prop of stillUnresolved) {
      if (!prop.pm_confidence) {
        prop.pm_confidence = 'unresolved';
        prop.status = 'pm_unresolved';
        progress.unresolved += 1;
      }
    }
  }

  // Step 5 — contact enrichment (dedupe by PM company)
  updateRun(runId, { current_step: 'step_5_contacts' });
  const runCache = new Map<string, CachedContact>();
  const marketHint = [geo.city, geo.state_code].filter(Boolean).join(', ');
  const resolvedProps = properties.filter(
    (p) => p.property_manager_company && p.pm_confidence && p.pm_confidence !== 'unresolved',
  );

  const companies = [...new Set(resolvedProps.map((p) => p.property_manager_company!))];
  const companyContacts = new Map<string, CachedContact | null>();

  for (const company of companies) {
    const result = await enrichPmCompany({
      company,
      marketHint,
      runId,
      runCache,
    });
    ({ breakdown } = addCost(breakdown, `contacts_${result.contact?.source ?? 'none'}`, result.cost));
    companyContacts.set(company, result.contact);
    progress.companies_enriched += 1;

    if (result.fromCache && result.contact) {
      progress.contacts_from_cache += 1;
    } else if (result.contact) {
      if (result.contact.source === 'getleads') progress.contacts_from_getleads += 1;
      if (result.contact.source === 'ai_ark') progress.contacts_from_ai_ark += 1;
      if (result.contact.source === 'leadmagic') progress.contacts_from_leadmagic += 1;
      if (result.contact.source === 'google_search') progress.contacts_from_google += 1;
    }
    bumpCost(progress, breakdown);
    updateProgress(runId, progress, breakdown, properties);
  }

  const contacts = [];
  for (const prop of resolvedProps) {
    const c = companyContacts.get(prop.property_manager_company!);
    if (!c) continue;
    prop.status = 'enriched';
    const rec = contactToRecord(runId, prop.id, c);
    contacts.push(rec);
    progress.contacts_found += 1;
  }

  const current = getRun(runId)!;
  current.contacts = contacts;
  current.properties = properties;
  bumpCost(progress, breakdown);
  updateProgress(runId, progress, breakdown, properties);
  await persistProperties(runId, properties);
  await persistContacts(contacts);

  updateRun(runId, { current_step: 'sync_scrape_leads' });
  const synced = await syncContactsToScrapeLeads(getRun(runId)!);
  progress.contacts_synced_to_scrape_leads = synced;
  updateProgress(runId, progress, breakdown, properties);
}

function bumpCost(progress: RunProgress, breakdown: Record<string, number>) {
  progress.cost_breakdown = breakdown;
  progress.cost_actual = sumBreakdown(breakdown);
}

function sumBreakdown(breakdown: Record<string, number>): number {
  return round6(Object.values(breakdown).reduce((a, b) => a + b, 0));
}

function updateProgress(
  runId: string,
  progress: RunProgress,
  breakdown: Record<string, number>,
  properties?: PropertyRecord[],
) {
  updateRun(runId, {
    progress: { ...progress },
    total_cost_actual: progress.cost_actual,
    cost_breakdown: breakdown,
    ...(properties ? { properties, total_records: properties.length } : {}),
  });
}
