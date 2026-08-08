import { Router } from 'express';
import { estimateCost } from '../lib/costs.js';
import { haversineMiles } from '../lib/zips.js';
import {
  createRun,
  getRun,
  listRuns,
  publicRunView,
  updateRun,
} from '../pipeline/jobStore.js';
import { resumeRun } from '../pipeline/resume.js';
import { startPipeline } from '../pipeline/runner.js';
import { planMarket } from '../services/planMarket.js';
import { countPmSync } from '../services/scrapeLeadsSync.js';
import { syncRunToSupabase } from '../services/syncToSupabase.js';
import type { ContactExportRow, ParsedQueryParams } from '../types.js';

export const runsRouter = Router();

/** Parse NL query + return estimate; does not spend money yet */
runsRouter.post('/parse', async (req, res) => {
  try {
    const query = String(req.body?.query ?? '').trim();
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const planned = await planMarket({
      query,
      zips: req.body?.zips,
      center: req.body?.center,
      radius_miles: req.body?.radius_miles != null ? Number(req.body.radius_miles) : undefined,
      exclude_categories: req.body?.exclude_categories,
      max_records: req.body?.max_records != null ? Number(req.body.max_records) : undefined,
    });
    const run = createRun({
      query,
      params: planned.parsed,
      estimate: planned.estimate,
    });

    res.json({
      run: publicRunView(run),
      parsed: planned.parsed,
      estimate: planned.estimate,
      zip_count: planned.zip_count,
      states: planned.states,
      center: planned.center,
      radius_miles: planned.radius_miles,
      geo_mode: planned.mode,
      needs_confirmation: true,
      ambiguous: Boolean(planned.parsed.ambiguous),
    });
  } catch (err) {
    console.error('[parse]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'parse failed' });
  }
});

/** Resolve ambiguity and refresh estimate without starting */
runsRouter.post('/:id/resolve-location', async (req, res) => {
  try {
    const run = getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    const location_value = String(req.body?.location_value ?? '').trim();
    if (!location_value) {
      res.status(400).json({ error: 'location_value is required' });
      return;
    }

    const planned = await planMarket({
      params: {
        ...run.parsed_params,
        location_value,
        center:
          run.parsed_params.location_type === 'radius' || run.parsed_params.center
            ? location_value
            : run.parsed_params.center,
        ambiguous: false,
        ambiguity_options: [],
        ambiguity_reason: null,
      },
    });
    const updated = updateRun(run.id, {
      parsed_params: planned.parsed,
      total_cost_estimate: planned.estimate.total_high,
      cost_estimate_detail: planned.estimate,
      status: 'awaiting_confirmation',
    });

    res.json({
      run: publicRunView(updated),
      parsed: planned.parsed,
      estimate: planned.estimate,
      zip_count: planned.zip_count,
      states: planned.states,
      center: planned.center,
      radius_miles: planned.radius_miles,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'resolve failed' });
  }
});

/** Explicit confirm — starts background pipeline */
runsRouter.post('/:id/confirm', async (req, res) => {
  try {
    const run = getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    if (run.parsed_params.ambiguous) {
      res.status(400).json({ error: 'Resolve location ambiguity before confirming' });
      return;
    }
    if (run.status === 'running' || run.status === 'completed') {
      res.json({ run: publicRunView(run) });
      return;
    }

    // Optional override of max_records for small test runs
    if (req.body?.max_records != null) {
      const max = Math.min(Math.max(Number(req.body.max_records), 1), 50000);
      const params = { ...run.parsed_params, max_records: max };
      const estimate = estimateCost(params);
      updateRun(run.id, {
        parsed_params: params,
        total_cost_estimate: estimate.total_high,
        cost_estimate_detail: estimate,
      });
    }

    // Do not set status=running here — startPipeline owns that transition.
    // Setting it early caused the runner's idempotency guard to no-op.
    updateRun(run.id, { current_step: 'queued' });
    void startPipeline(run.id);
    res.json({ run: publicRunView(getRun(run.id)!) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'confirm failed' });
  }
});

/**
 * Maps-style sync_to_supabase: persist property_pm_finder.* + scrape_jobs/leads/exports.
 * Returns counts only — keep Claude context low.
 */
runsRouter.post('/:id/sync-to-supabase', async (req, res) => {
  try {
    const result = await syncRunToSupabase(req.params.id);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'sync failed' });
  }
});

/** Count-only verification against Supabase (no row payloads). */
runsRouter.get('/:id/sync-counts', async (req, res) => {
  try {
    const counts = await countPmSync(req.params.id);
    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'count failed' });
  }
});

/** Resume a stopped run from Supabase (skip Propwire / c/o; continue PM + contacts). */
runsRouter.post('/:id/resume', async (req, res) => {
  try {
    const fromRaw = String(req.body?.from ?? 'loopnet');
    const from =
      fromRaw === 'google' || fromRaw === 'contacts' || fromRaw === 'loopnet'
        ? fromRaw
        : 'loopnet';
    const result = await resumeRun({ runId: req.params.id, from });
    res.json(result);
  } catch (err) {
    console.error('[resume]', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'resume failed' });
  }
});

runsRouter.get('/', (_req, res) => {
  res.json({ runs: listRuns().map(publicRunView) });
});

runsRouter.get('/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  res.json({ run: publicRunView(run) });
});

runsRouter.get('/:id/results', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  const q = String(req.query.q ?? '').toLowerCase();
  const confidence = String(req.query.pm_confidence ?? '');
  const source = String(req.query.contact_source ?? '');

  let rows = buildExportRows(run);
  if (q) {
    rows = rows.filter((r) =>
      [
        r.contact_name,
        r.contact_email,
        r.property_manager_company,
        r.owner_entity_name,
        r.address,
        r.city,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }
  if (confidence) {
    rows = rows.filter((r) => r.pm_confidence === confidence);
  }
  if (source) {
    rows = rows.filter((r) => r.contact_source === source);
  }

  res.json({
    run: publicRunView(run),
    rows,
    total: rows.length,
  });
});

runsRouter.get('/:id/export.csv', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  let rows = buildExportRows(run);
  const center = typeof req.query.center === 'string' ? req.query.center : '';
  const radiusMiles = req.query.radius_miles != null ? Number(req.query.radius_miles) : NaN;
  if (center && Number.isFinite(radiusMiles) && radiusMiles > 0) {
    const coord = center.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) {
      const lat = Number(coord[1]);
      const lng = Number(coord[2]);
      rows = rows.filter((r) => {
        if (r.latitude == null || r.longitude == null) return false;
        return haversineMiles(lat, lng, r.latitude, r.longitude) <= radiusMiles;
      });
    }
  }

  const headers: (keyof ContactExportRow)[] = [
    'contact_name',
    'contact_title',
    'contact_email',
    'contact_phone',
    'contact_source',
    'match_confidence',
    'property_manager_company',
    'pm_confidence',
    'pm_source',
    'owner_entity_name',
    'owner_type',
    'care_of_company',
    'address',
    'city',
    'state',
    'zip',
    'latitude',
    'longitude',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pm-finder-${run.id.slice(0, 8)}.csv"`,
  );
  res.send(lines.join('\n'));
});

function buildExportRows(run: ReturnType<typeof getRun> & object): ContactExportRow[] {
  const job = run as NonNullable<ReturnType<typeof getRun>>;
  const byProperty = new Map(job.contacts.map((c) => [c.property_id, c]));

  // Contact-level export: one row per contact; properties without contacts still appear
  // so unresolved PM rows are visible for QA.
  if (job.contacts.length) {
    return job.contacts.map((c) => {
      const p = job.properties.find((x) => x.id === c.property_id);
      return {
        contact_name: c.contact_name,
        contact_title: c.contact_title,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
        contact_source: c.source,
        match_confidence: c.match_confidence,
        property_manager_company: c.property_manager_company,
        pm_confidence: p?.pm_confidence ?? null,
        pm_source: p?.pm_source ?? null,
        owner_entity_name: p?.owner_entity_name ?? null,
        owner_type: p?.owner_type ?? null,
        care_of_company: p?.care_of_company ?? null,
        address: p?.address ?? null,
        city: p?.city ?? null,
        state: p?.state ?? null,
        zip: p?.zip ?? null,
        latitude: p?.latitude ?? null,
        longitude: p?.longitude ?? null,
      };
    });
  }

  return job.properties.map((p) => {
    const c = byProperty.get(p.id);
    return {
      contact_name: c?.contact_name ?? null,
      contact_title: c?.contact_title ?? null,
      contact_email: c?.contact_email ?? null,
      contact_phone: c?.contact_phone ?? null,
      contact_source: c?.source ?? null,
      match_confidence: c?.match_confidence ?? null,
      property_manager_company: p.property_manager_company,
      pm_confidence: p.pm_confidence,
      pm_source: p.pm_source,
      owner_entity_name: p.owner_entity_name,
      owner_type: p.owner_type,
      care_of_company: p.care_of_company,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      latitude: p.latitude,
      longitude: p.longitude,
    };
  });
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
