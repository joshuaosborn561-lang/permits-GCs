# Permit & Parcel MCP (`permits-GCs`)

GitHub: https://github.com/joshuaosborn561-lang/permits-GCs  
(formerly `property-management-scraper` / misnamed “Property Owners”)

SalesGlider MCP for public **permit + parcel** records — not a people-resolver:

1. **Shovels commercial contractors** (~6,124 DFW GCs) — cached CSV
2. **Shovels API credit estimates** — cached query = 0 credits; live API = 1 credit per record
3. **Calling lists in Supabase** — persist pulls so Cayden (or anyone) can filter them for cold calling
4. **Appraisal-district commercial parcels** — DCAD / TAD / CCAD bulk extracts
5. **Operator rollup** — group shell LLCs by normalised tax-bill mailing address (`build_operators`)

The Propwire → LoopNet → Google owner cascade was **removed**.

## Supabase target

This service writes to project **`kemvxzhcxvynmoutwdrh`**, schema **`permit_parcel`**, and contractor lists also land in **`public.scrape_leads`**.  
`health` and every `sync_to_supabase` / `save_calling_list` / `build_operators` response include `supabase_project` + `supabase_schema`. The Google Maps Scraper MCP may use a different project — always check before diagnosing missing tables.

## MCP tools

| Tool | Purpose |
|------|---------|
| `health` | Readiness + `supabase_project` + loaded counts |
| `shovels_estimate_credits` | How many Shovels API credits a filter would cost |
| `permits_contractors_*` | Shovels GC summary/query/sample/export |
| `save_calling_list` | Write a filtered pull to Supabase (`owner` e.g. `cayden`) |
| `list_calling_lists` / `query_calling_list` | Find and filter saved cold-calling lists |
| `parcels_*` | CAD parcel summary/query/sample/export |
| `build_operators` | Mailing-address operator rollup → `permit_parcel.operators` (counts only) |
| `sync_to_supabase` | Full matching-set S2S sync — **counts only**; contractor syncs also catalog a calling list |

Prefer save/sync + SQL `select count(*)` over dumping rows into chat.

Claude connector: `https://workspace-production-4702.up.railway.app/mcp` (authless).

## Shovels credits

Paid Shovels plans bill **1 credit per record returned**. These MCP tools read the **local snapshot** and spend **0** credits. `shovels_estimate_credits` always returns both numbers so you can ask Claude “what would this cost?” before saving a list.

## Calling lists (Cayden)

1. Estimate (optional): `shovels_estimate_credits` with place/city/`has_phone`
2. Save: `save_calling_list` with `owner=cayden` and a name
3. Later: `list_calling_lists(owner=cayden)` → `query_calling_list(has_phone=true)`

## Sync rules

- No silent 50k truncation — syncs the full matching set (`truncated: false`)
- Honours `county` (and other parcel filters)
- Fails if `rows_inserted > 0` but `permit_parcel_schema_upserted = 0`
- Natural key `(county, account_id)` with stable id `county:account_id`

## Free LLC unmasking (do not buy)

Do **not** bulk-buy paid SOS products for tens of thousands of LLCs. Cheapest path:

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
- `local_llc` — operators + free Comptroller PIR
- `institutional` — drop from private-operator outreach
- `municipal` — city / county / ISD / housing authority / etc. (segmentable)
- `unknown` — residual
