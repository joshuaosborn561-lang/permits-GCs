# Permit & Parcel MCP (`permits-GCs`)

GitHub: https://github.com/joshuaosborn561-lang/permits-GCs  
(formerly `property-management-scraper` / misnamed “Property Owners”)

SalesGlider MCP for public **permit + parcel** records — not a people-resolver:

1. **Shovels commercial contractors** (~6,124 DFW GCs) — cached CSV
2. **Shovels API key from Claude** — Cayden can set or change it with `shovels_set_api_key`
3. **Shovels API credit estimates** — live `include_count`; quote free (pages) and paid (companies)
4. **Calling lists in Supabase** — persist pulls so Cayden (or anyone) can filter them for cold calling
5. **Appraisal-district commercial parcels** — DCAD / TAD / CCAD bulk extracts
6. **Operator rollup** — group shell LLCs by normalised tax-bill mailing address (`build_operators`)

The Propwire → LoopNet → Google owner cascade was **removed**.

## Supabase target

This service writes to project **`kemvxzhcxvynmoutwdrh`**, schema **`permit_parcel`**, and contractor lists also land in **`public.scrape_leads`**.  
`health` and every `sync_to_supabase` / `save_calling_list` / `build_operators` response include `supabase_project` + `supabase_schema`. The Google Maps Scraper MCP may use a different project — always check before diagnosing missing tables.

## MCP tools

| Tool | Purpose |
|------|---------|
| `health` | Readiness + `supabase_project` + loaded counts |
| `shovels_api_key_status` | Masked fingerprint of the live Shovels key |
| `shovels_set_api_key` | Cayden sets/changes the key from Claude (`confirm=true`) |
| `shovels_clear_api_key` | Drop the Claude override and fall back to env |
| `shovels_estimate_credits` | How many Shovels API credits a filter would cost |
| `permits_contractors_*` | Shovels GC summary/query/sample/export |
| `save_calling_list` | Write a filtered pull to Supabase (`owner` e.g. `cayden`) |
| `list_calling_lists` / `query_calling_list` | Find and filter saved lists (`exclude_national_chains`, `dial_status=owner_cell`) |
| `score_calling_list` | Free owner vs office score |
| `match_texas_officers` | Texas Comptroller PIR officers |
| `lookup_line_type` | Veriphone Standard (~$2.40/1k) cell vs landline |
| `owner_people_search` / `record_owner_cell` | Google + free people-search leftovers |
| `set_enrichment_api_key` | Cayden pastes Veriphone / Texas CPA keys |
| `parcels_*` | CAD parcel summary/query/sample/export |
| `build_operators` | Mailing-address operator rollup → `permit_parcel.operators` (counts only) |
| `sync_to_supabase` | Full matching-set S2S sync — **counts only**; contractor syncs also catalog a calling list |

Prefer save/sync + SQL `select count(*)` over dumping rows into chat.

Claude connector: `https://workspace-production-4702.up.railway.app/mcp` (authless).

## Shovels credits

`shovels_estimate_credits` calls Shovels `include_count` (one cheap request per city/county) and returns **both** meters: free/trial **pages** and paid **companies**. Last Dallas + Tarrant commercial job was **65 pages / ~6,400 companies**. A Railway `SHOVELS_API_KEY` still works as fallback.

Cayden can change the live key from Claude with `shovels_set_api_key` (`confirm=true`). The server never echoes the full key — only a masked fingerprint. The value is stored in `permit_parcel.app_settings` and reloaded on restart. This MCP is authless, so anyone with the connector URL can set the key.

## Calling lists (Cayden)

1. Optional: `shovels_set_api_key` if he wants to use his own Shovels key
2. Estimate (optional): `shovels_estimate_credits` with place/city/`has_phone`
3. Save: `save_calling_list` with `owner=cayden` and `exclude_national_chains=true` (keeps local GCs of any permit volume)
4. `score_calling_list` → `match_texas_officers` → `lookup_line_type` (confirm $ first)
5. Leftovers: `owner_people_search` then `record_owner_cell` for wireless hits
6. Dial: `query_calling_list(owner=cayden, exclude_national_chains=true, dial_status=owner_cell)`

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
SHOVELS_API_KEY=   # optional fallback; Cayden can set the live key from Claude
VERIPHONE_API_KEY= # or paste via set_enrichment_api_key
TEXAS_CPA_API_KEY= # Comptroller public API; or paste via Claude
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
