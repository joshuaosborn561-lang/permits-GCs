# Permit & Parcel MCP (`permits-GCs`)

GitHub: https://github.com/joshuaosborn561-lang/permits-GCs  
(formerly `property-management-scraper`)

SalesGlider MCP for:

1. **Shovels commercial contractors** (~6,124 DFW GCs) — cached CSV
2. **Appraisal-district commercial parcels** — DCAD / TAD / CCAD bulk extracts
3. **OpenSOS** — entity → officers for **local LLC** owners (~$0.03/lookup)

The Propwire → LoopNet → Google owner cascade was **removed** (broken: mailing addresses as owners, zero contacts after $6+ spend).

## MCP tools

| Tool | Purpose |
|------|---------|
| `health` | Readiness + loaded counts |
| `permits_contractors_*` | Shovels GC summary/query/sample/export |
| `parcels_*` | CAD parcel summary/query/sample/export |
| `opensos_lookup` | Officers for local LLCs |
| `sync_to_supabase` | Maps-style S2S sync — **counts only** |

Prefer `sync_to_supabase` + SQL `select count(*)` over dumping rows into chat.

## Data

Normalized commercial CSVs (refresh annually):

- `data/parcels/dcad/commercial_parcels.csv`
- `data/parcels/tad/commercial_parcels.csv`
- `data/parcels/ccad/commercial_parcels.csv`
- `data/shovels_commercial_contractors/commercial_contractors_contacts.csv`

See each county `README.md` for download URLs.

## Env

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_INGEST_SECRET=
OPENSOSDATA_API_KEY=
```

## Run

```bash
npm install
npm run build
npm start
# MCP: https://<host>/mcp  (authless)
```

## Owner-type routing

- `individual` — owner is decision maker
- `local_llc` — call OpenSOS
- `institutional` — drop (fund/REIT/trust)
