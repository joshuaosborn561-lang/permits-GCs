import { Router } from 'express';
import {
  parcelsSummary,
  parcelsToCsv,
  queryParcels,
  sampleParcels,
} from '../services/parcels.js';
import { syncParcelsToSupabase } from '../services/syncToSupabase.js';

export const parcelsRouter = Router();

function queryFrom(req: { query: Record<string, unknown>; body?: Record<string, unknown> }) {
  const src = { ...req.query, ...(req.body ?? {}) };
  return {
    county: src.county != null ? String(src.county) : undefined,
    owner_name: src.owner_name != null ? String(src.owner_name) : undefined,
    city: src.city != null ? String(src.city) : undefined,
    zip: src.zip != null ? String(src.zip) : undefined,
    use_code: src.use_code != null ? String(src.use_code) : undefined,
    owner_type: src.owner_type != null ? String(src.owner_type) : undefined,
    min_assessed_value:
      src.min_assessed_value != null ? Number(src.min_assessed_value) : undefined,
    q: src.q != null ? String(src.q) : undefined,
    page: src.page != null ? Number(src.page) : undefined,
    page_size: src.page_size != null ? Number(src.page_size) : undefined,
  };
}

parcelsRouter.get('/summary', (_req, res) => {
  res.json(parcelsSummary());
});

parcelsRouter.get('/sample', (req, res) => {
  const n = req.query.n != null ? Number(req.query.n) : 20;
  res.json(sampleParcels(n, queryFrom(req)));
});

parcelsRouter.get('/export.csv', (req, res) => {
  const q = queryFrom(req);
  const pageSize = 50;
  let page = 1;
  const items = [];
  for (;;) {
    const batch = queryParcels({ ...q, page, page_size: pageSize });
    items.push(...batch.items);
    if (page >= batch.total_pages || items.length >= 5000) break;
    page += 1;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="parcels.csv"');
  res.send(parcelsToCsv(items.slice(0, 5000)));
});

parcelsRouter.post('/sync-to-supabase', async (req, res) => {
  try {
    const result = await syncParcelsToSupabase(queryFrom(req));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'sync failed' });
  }
});

parcelsRouter.get('/', (req, res) => {
  res.json(queryParcels(queryFrom(req)));
});
