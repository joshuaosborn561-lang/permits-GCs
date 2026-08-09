# Permit & Parcel MCP (`permits-GCs`)

GitHub: https://github.com/joshuaosborn561-lang/permits-GCs  
(formerly `property-management-scraper` / misnamed “Property Owners”)

SalesGlider MCP for public **permit + parcel** records — not a people-resolver:

1. **Shovels commercial contractors** (~6,124 DFW GCs) — cached CSV
2. **Appraisal-district commercial parcels** — DCAD / TAD / CCAD bulk extracts
3. **Operator rollup** — group shell LLCs by normalised tax-bill mailing address (`build_operators`)
4. **OpenSOS** — entity → officers for **local LLC** owners only (~$0.03/lookup), after estimate + approval

The Propwire → LoopNet → Google owner cascade was **removed**.

## Supabase target

This service writes to project **`kemvxzhcxvynmoutwdrh`**, schema **`permit_parcel`**.  
`health` and every `sync_to_supabase` / `build_operators` response include `supabase_project` + `supabase_schema`. The Google Maps Scraper MCP may use a different project — always check before diagnosing missing tables.

## MCP tools

| Tool | Purpose |
|------|---------|
| `health` | Readiness + `supabase_project` + loaded counts |
| `permits_contractors_*` | Shovels GC summary/query/sample/export |
| `parcels_*` | CAD parcel summary/query/sample/export |
| `build_operators` | Mailing-address operator rollup → `permit_parcel.operators` (counts only) |
| `opensos_estimate` / `opensos_lookup` | Spend-gated LLC officers |
| `sync_to_supabase` | Full matching-set S2S sync — **counts only**; upserts parcels on `(county, account_id)` |

Prefer sync/operators + SQL `select count(*)` over dumping rows into chat.

## Sync rules

- No silent 50k truncation — syncs the full matching set (`truncated: false`)
- Honours `county` (and other parcel filters)
- Fails if `rows_inserted > 0` but `permit_parcel_schema_upserted = 0`
- Natural key `(county, account_id)` with stable id `county:account_id`

## Free LLC unmasking (do not buy)

Do **not** bulk-buy OpenSOS / SOSDirect for tens of thousands of LLCs. Cheapest path:

1. Filter by `min_assessed_value`
2. `build_operators` — resolve mailing-address operators, not every shell entity
3. Join Texas Comptroller **Public Information Report** (Form 05-102) bulk files (Open Data Portal / Open Records) — free

Registered agents (CT Corporation, law firms) are **not** owners — prefer PIR officer/director fields.

## Data

Normalized commercial CSVs (refresh annually):

- `data/parcels/dcad/commercial_parcels.csv`
- `data/parcels/tad/commercial_parcels.csv`
- `data/parcels/ccad/commercial_parcels.csv`
- `data/shovels_commercial_contractors/commercial_contractors_contacts.csv`

## Env

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_INGEST_SECRET=
OPENSOSDATA_API_KEY=
OPENSOS_MONTHLY_LIMIT=1000
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
- `local_llc` — optional OpenSOS after estimate + approval
- `institutional` — drop from private-operator outreach
- `municipal` — city / county / ISD / housing authority / etc. (segmentable)
- `unknown` — residual
