import { Router } from 'express';
import { openSosLookup } from '../services/openSos.js';

export const openSosRouter = Router();

openSosRouter.post('/lookup', async (req, res) => {
  try {
    const entity_name = String(req.body?.entity_name ?? '').trim();
    const state = String(req.body?.state ?? 'TX').trim();
    const force = Boolean(req.body?.force);
    const allow_non_llc = Boolean(req.body?.allow_non_llc);
    const result = await openSosLookup({ entity_name, state, force, allow_non_llc });
    res.status(result.ok || result.skipped ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'lookup failed' });
  }
});
