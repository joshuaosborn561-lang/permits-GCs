import {
  getRun,
  loadRunFromSupabase,
  persistContacts,
  persistProperties,
  updateRun,
  type RunJob,
} from '../pipeline/jobStore.js';
import { hasSupabase } from '../lib/supabase.js';
import {
  countPmSync,
  syncRunToScrapeLeads,
  type SyncToSupabaseResult,
} from './scrapeLeadsSync.js';

export interface FullSyncResult extends SyncToSupabaseResult {
  assistant_instructions: string;
  db_counts?: Record<string, unknown>;
}

/**
 * Server-to-server sync for a Property PM Finder run.
 * Prefer this over dumping rows into Claude context.
 * Returns counts + verify_sql only.
 */
export async function syncRunToSupabase(runId: string): Promise<FullSyncResult> {
  let job = getRun(runId);
  if (!job && hasSupabase()) {
    job = (await loadRunFromSupabase(runId)) ?? undefined;
  }
  if (!job) {
    return {
      ok: false,
      supabase_configured: hasSupabase(),
      run_id: runId,
      scrape_job_id: `pmf-${runId}`,
      mode: 'empty',
      counts: {
        properties_in_run: 0,
        contacts_in_run: 0,
        property_pm_finder_properties_upserted: 0,
        property_pm_finder_contacts_upserted: 0,
        scrape_leads_deleted: 0,
        scrape_leads_inserted: 0,
        scrape_export_bytes: 0,
        contacts_by_source: {},
      },
      verify_sql: [],
      error: 'run not found in memory or Supabase',
      assistant_instructions:
        'Run not found. Use pmf_list_runs or check property_pm_finder.runs with select count(*).',
    };
  }

  // Re-upsert dedicated schema rows (idempotent on id)
  await persistProperties(job.id, job.properties);
  await persistContacts(job.contacts);

  const scrape = await syncRunToScrapeLeads(job);

  // Mirror sync counters onto run progress (no row dump)
  try {
    updateRun(job.id, {
      progress: {
        ...job.progress,
        contacts_synced_to_scrape_leads: scrape.counts.scrape_leads_inserted,
      },
    });
  } catch {
    // run may be read-only hydrate; ignore
  }

  const dbCounts = await countPmSync(job.id);

  return {
    ...scrape,
    counts: {
      ...scrape.counts,
      property_pm_finder_properties_upserted: job.properties.length,
      property_pm_finder_contacts_upserted: job.contacts.length,
    },
    db_counts: dbCounts,
    assistant_instructions:
      'Sync finished server-to-server. Do NOT pull or rewrite rows in chat. Verify with the verify_sql count(*) statements (or Supabase MCP execute_sql). Prefer counts over pmf_get_results / CSV dumps.',
  };
}

export async function syncLatestCompletedToSupabase(): Promise<FullSyncResult> {
  const { listRuns } = await import('../pipeline/jobStore.js');
  const completed = listRuns().find((r) => r.status === 'completed' || r.contacts.length > 0);
  if (!completed) {
    return {
      ok: false,
      supabase_configured: hasSupabase(),
      run_id: '',
      scrape_job_id: '',
      mode: 'empty',
      counts: {
        properties_in_run: 0,
        contacts_in_run: 0,
        property_pm_finder_properties_upserted: 0,
        property_pm_finder_contacts_upserted: 0,
        scrape_leads_deleted: 0,
        scrape_leads_inserted: 0,
        scrape_export_bytes: 0,
        contacts_by_source: {},
      },
      verify_sql: [],
      error: 'no completed in-memory run to sync',
      assistant_instructions: 'Pass an explicit run_id.',
    };
  }
  return syncRunToSupabase(completed.id);
}

/** Ensure job reference type export for callers. */
export type { RunJob };
