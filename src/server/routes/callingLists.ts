import { Router } from 'express';
import { listCallingLists, queryCallingList, saveCallingList } from '../services/callingLists.js';

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
        page: req.query.page ? Number(req.query.page) : undefined,
        page_size: req.query.page_size ? Number(req.query.page_size) : undefined,
      }),
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'query failed' });
  }
});
