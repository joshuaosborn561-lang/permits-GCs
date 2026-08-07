import { config } from '../config.js';
import { geocodeLocation } from '../lib/geocode.js';
import { emptyProgress, type PropertyRecord, type RunProgress } from '../types.js';
import {
  getRun,
  loadRunFromSupabase,
  publicRunView,
  updateRun,
} from './jobStore.js';
import { startPipelineFromOwnerParse } from './runner.js';

/**
 * Resume a stopped run from Supabase.
 * Default: skip Propwire + c/o re-parse; continue LoopNet → Google → contacts
 * for properties that still lack a PM company.
 */
export async function resumeRun(opts: {
  runId: string;
  /** Where to resume. Default loopnet. */
  from?: 'loopnet' | 'google' | 'contacts';
}): Promise<{ run: ReturnType<typeof publicRunView>; resumed: number; message: string }> {
  let job = getRun(opts.runId);
  if (!job) {
    job = (await loadRunFromSupabase(opts.runId)) ?? undefined;
  }
  if (!job) {
    throw new Error(`Run ${opts.runId} not found in memory or Supabase`);
  }
  if (!job.properties.length) {
    throw new Error('Run has no persisted properties to resume');
  }
  if (job.status === 'running' && job.current_step && !String(job.current_step).includes('loopnet')) {
    // Allow resume of a stuck "running" loopnet job after process death.
  }

  const from = opts.from ?? 'loopnet';
  const needsPm = job.properties.filter(
    (p) => !p.property_manager_company || p.pm_confidence === 'unresolved' || !p.pm_confidence,
  );

  // Reset step counters that will be recomputed for unresolved rows only.
  const progress: RunProgress = {
    ...emptyProgress(),
    ...job.progress,
    records_pulled: job.properties.length,
    // Keep prior resolved_co; loopnet/google/contacts will add from here.
    resolved_loopnet: job.properties.filter((p) => p.pm_source === 'LoopNet listing').length,
    resolved_google: job.properties.filter((p) => p.pm_source === 'Google search').length,
    resolved_co: job.properties.filter((p) => p.pm_source === 'c/o field').length,
  };

  updateRun(job.id, {
    status: 'running',
    current_step: `resuming_${from}`,
    error_message: null,
    progress,
    total_records: job.properties.length,
  });

  // Fire-and-forget continuation (same pattern as confirm).
  void (async () => {
    try {
      const geo = await geocodeLocation(job!.parsed_params);
      await startPipelineFromOwnerParse({
        runId: job!.id,
        properties: job!.properties,
        unresolvedAfterCo: needsPm,
        progress,
        breakdown: { ...job!.cost_breakdown },
        geo,
        skipLoopnet: from === 'google' || from === 'contacts',
        skipGoogle: from === 'contacts',
      });
      updateRun(job!.id, { status: 'completed', current_step: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[resume] failed', job!.id, message);
      updateRun(job!.id, {
        status: 'failed',
        current_step: 'failed',
        error_message: message,
      });
    }
  })();

  return {
    run: publicRunView(getRun(job.id)!),
    resumed: needsPm.length,
    message:
      `Resuming ${needsPm.length} properties without a PM from ${from} ` +
      `(LOOPNET_MODE=${config.loopnetMode}). Propwire/c/o parse skipped.`,
  };
}

export function propertiesNeedingPm(properties: PropertyRecord[]): PropertyRecord[] {
  return properties.filter(
    (p) => !p.property_manager_company || p.pm_confidence === 'unresolved' || !p.pm_confidence,
  );
}
