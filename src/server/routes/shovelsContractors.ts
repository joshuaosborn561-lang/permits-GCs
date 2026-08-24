import { Router } from 'express';
import { estimateShovelsCredits } from '../services/shovelsCredits.js';
import {
  contractorsToCsv,
  getShovelsContractor,
  queryShovelsContractors,
  sampleShovelsContractors,
  shovelsContractorsSummary,
  type ContractorQuery,
} from '../services/shovelsContractors.js';

function boolParam(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return undefined;
}

function queryFromReq(req: { query: Record<string, unknown> }): ContractorQuery {
  return {
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    place: typeof req.query.place === 'string' ? req.query.place : undefined,
    city: typeof req.query.city === 'string' ? req.query.city : undefined,
    state: typeof req.query.state === 'string' ? req.query.state : undefined,
    has_email: boolParam(req.query.has_email),
    has_phone: boolParam(req.query.has_phone),
    has_website: boolParam(req.query.has_website),
  };
}

function queryAllMatching(base: ContractorQuery, max = 5000) {
  const pageSize = 50;
  let page = 1;
  const items = [];
  for (;;) {
    const batch = queryShovelsContractors({ ...base, page, page_size: pageSize });
    items.push(...batch.items);
    if (page >= batch.total_pages || items.length >= max) break;
    page += 1;
  }
  return items.slice(0, max);
}

export const shovelsContractorsRouter = Router();

/** Summary counts only — never full rows. */
shovelsContractorsRouter.get('/summary', (_req, res) => {
  res.json(shovelsContractorsSummary());
});

/** Shovels API credit estimate (cached=0, live API=1/record). */
shovelsContractorsRouter.get('/estimate-credits', (req, res) => {
  res.json(
    estimateShovelsCredits({
      ...queryFromReq(req),
      max_records: req.query.max_records ? Number(req.query.max_records) : undefined,
    }),
  );
});

/** Up to 20 random rows for quality inspection. */
shovelsContractorsRouter.get('/sample', (req, res) => {
  const n = req.query.n ? Number(req.query.n) : 20;
  res.json(sampleShovelsContractors(n, queryFromReq(req)));
});

/** Filtered CSV export. Caps at 5000 rows. */
shovelsContractorsRouter.get('/export.csv', (req, res) => {
  const capped = queryAllMatching(queryFromReq(req), 5000);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="shovels_commercial_contractors.csv"',
  );
  res.send(contractorsToCsv(capped));
});

/** Paginated query (max 50/page). */
shovelsContractorsRouter.get('/', (req, res) => {
  res.json(
    queryShovelsContractors({
      ...queryFromReq(req),
      page: req.query.page ? Number(req.query.page) : 1,
      page_size: req.query.page_size ? Number(req.query.page_size) : 25,
    }),
  );
});

shovelsContractorsRouter.get('/:id', (req, res) => {
  const row = getShovelsContractor(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Contractor not found' });
    return;
  }
  res.json(row);
});
