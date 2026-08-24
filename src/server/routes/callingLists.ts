import { Router } from 'express';
import { listCallingLists, queryCallingList, saveCallingList } from '../services/callingLists.js';
import {
  lookupLineTypes,
  matchTexasOfficers,
  ownerPeopleSearch,
  recordOwnerCell,
  scoreCallingList,
} from '../services/enrichCallingList.js';
import { enrichmentKeysStatus, setAppSetting } from '../lib/appSettings.js';

export const callingListsRouter = Router();

callingListsRouter.get('/', async (req, res) => {
  try {
    res.json(
      await listCallingLists({
        owner: typeof req.query.owner === 'string' ? req.query.owner : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'list failed' });
  }
});

callingListsRouter.post('/', async (req, res) => {
  try {
    const result = await saveCallingList({
      name: req.body?.name,
      owner: req.body?.owner,
      contractor_query: {
        q: req.body?.q,
        place: req.body?.place,
        city: req.body?.city,
        state: req.body?.state,
        has_email: req.body?.has_email,
        has_phone: req.body?.has_phone,
        has_website: req.body?.has_website,
      },
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'save failed' });
  }
});

callingListsRouter.get('/query', async (req, res) => {
  try {
    const bool = (v: unknown) => {
      if (v === undefined || v === null || v === '') return undefined;
      if (v === true || v === 'true' || v === '1') return true;
      if (v === false || v === 'false' || v === '0') return false;
      return undefined;
    };
    res.json(
      await queryCallingList({
        list_id: typeof req.query.list_id === 'string' ? req.query.list_id : undefined,
        owner: typeof req.query.owner === 'string' ? req.query.owner : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        city: typeof req.query.city === 'string' ? req.query.city : undefined,
        state: typeof req.query.state === 'string' ? req.query.state : undefined,
        has_phone: bool(req.query.has_phone),
        has_email: bool(req.query.has_email),
        dial_status: typeof req.query.dial_status === 'string' ? req.query.dial_status : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        page_size: req.query.page_size ? Number(req.query.page_size) : undefined,
      }),
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'query failed' });
  }
});

callingListsRouter.get('/enrichment/keys', async (_req, res) => {
  try {
    res.json(await enrichmentKeysStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'status failed' });
  }
});

callingListsRouter.post('/enrichment/keys', async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({ ok: false, error: 'Set confirm=true to save an API key' });
      return;
    }
    const result = await setAppSetting({
      key: String(req.body?.key ?? ''),
      api_key: String(req.body?.api_key ?? ''),
      set_by: typeof req.body?.set_by === 'string' ? req.body.set_by : undefined,
      persist: req.body?.persist,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'set key failed' });
  }
});

callingListsRouter.post('/score', async (req, res) => {
  try {
    const result = await scoreCallingList({
      list_id: String(req.body?.list_id ?? req.query.list_id ?? ''),
      limit: req.body?.limit ? Number(req.body.limit) : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'score failed' });
  }
});

callingListsRouter.post('/officers', async (req, res) => {
  try {
    const result = await matchTexasOfficers({
      list_id: String(req.body?.list_id ?? ''),
      limit: req.body?.limit ? Number(req.body.limit) : undefined,
      only_unmatched: req.body?.only_unmatched,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'officer match failed' });
  }
});

callingListsRouter.post('/line-type', async (req, res) => {
  try {
    const result = await lookupLineTypes({
      list_id: String(req.body?.list_id ?? ''),
      confirm: req.body?.confirm === true,
      limit: req.body?.limit ? Number(req.body.limit) : undefined,
      only_unknown: req.body?.only_unknown,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'line-type failed' });
  }
});

callingListsRouter.post('/people-search', async (req, res) => {
  try {
    const result = await ownerPeopleSearch({
      list_id: String(req.body?.list_id ?? ''),
      limit: req.body?.limit ? Number(req.body.limit) : undefined,
      dial_status: typeof req.body?.dial_status === 'string' ? req.body.dial_status : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'people-search failed' });
  }
});

callingListsRouter.post('/owner-cell', async (req, res) => {
  try {
    const result = await recordOwnerCell({
      list_id: String(req.body?.list_id ?? ''),
      lead_id: Number(req.body?.lead_id),
      phone: String(req.body?.phone ?? ''),
      source: typeof req.body?.source === 'string' ? req.body.source : undefined,
      line_type: typeof req.body?.line_type === 'string' ? req.body.line_type : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'record failed' });
  }
});
