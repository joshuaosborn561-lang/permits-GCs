import { Router } from 'express';
import {
  clearShovelsApiKey,
  getShovelsKeyStatus,
  setShovelsApiKey,
} from '../lib/shovelsKey.js';

export const shovelsApiKeyRouter = Router();

shovelsApiKeyRouter.get('/', async (_req, res) => {
  try {
    res.json(await getShovelsKeyStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'status failed' });
  }
});

shovelsApiKeyRouter.post('/', async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({
        ok: false,
        error: 'Set confirm=true to change the Shovels API key. The full key is never echoed back.',
      });
      return;
    }
    const result = await setShovelsApiKey({
      api_key: String(req.body?.api_key ?? ''),
      set_by: typeof req.body?.set_by === 'string' ? req.body.set_by : undefined,
      persist: req.body?.persist,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'set failed' });
  }
});

shovelsApiKeyRouter.delete('/', async (req, res) => {
  try {
    const confirm =
      req.body?.confirm === true || req.query.confirm === 'true' || req.query.confirm === '1';
    if (!confirm) {
      res.status(400).json({ ok: false, error: 'Set confirm=true to clear the Shovels API key' });
      return;
    }
    res.json(
      await clearShovelsApiKey({
        set_by: typeof req.body?.set_by === 'string' ? req.body.set_by : undefined,
      }),
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'clear failed' });
  }
});
