import { Router } from 'express';
import { getOpenSosUsage, openSosEstimate, openSosLookup } from '../services/openSos.js';

export const openSosRouter = Router();

openSosRouter.get('/usage', async (_req, res) => {
  try {
    res.json(await getOpenSosUsage());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'usage failed' });
  }
});

openSosRouter.post('/estimate', async (req, res) => {
  try {
    const raw = req.body?.entity_names ?? req.body?.entity_name;
    const entity_names = Array.isArray(raw)
      ? raw.map(String)
      : raw
        ? [String(raw)]
        : [];
    const result = await openSosEstimate({
      entity_names,
      state: req.body?.state != null ? String(req.body.state) : undefined,
      force: Boolean(req.body?.force),
      allow_non_llc: Boolean(req.body?.allow_non_llc),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'estimate failed' });
  }
});

openSosRouter.post('/lookup', async (req, res) => {
  try {
    const entity_name = String(req.body?.entity_name ?? '').trim();
    const state = String(req.body?.state ?? 'TX').trim();
    const force = Boolean(req.body?.force);
    const allow_non_llc = Boolean(req.body?.allow_non_llc);
    const confirm_spend = req.body?.confirm_spend === true;
    const result = await openSosLookup({
      entity_name,
      state,
      force,
      allow_non_llc,
      confirm_spend,
    });
    const status = result.ok || result.skipped ? 200 : result.needs_approval ? 402 : 400;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'lookup failed' });
  }
});
