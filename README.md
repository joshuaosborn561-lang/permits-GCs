# SalesGlider · Property PM Finder

Internal pipeline + web UI that turns a natural-language request like **"get me all commercial property owners in Fort Worth, TX"** into a deduplicated, contact-level CSV of commercial owners, property managers, and decision-maker contacts.

Built for SalesGlider Growth outbound. Data lands in a dedicated Supabase schema (`property_pm_finder`) and exports at the **contact level** for Smartlead later.

## What it does

1. **Parse** free text → structured location params (Gemini 2.5 Flash-Lite)
2. **Propwire** pull (Apify `solidcode/propwire-com-scraper`) — commercial, full detail
3. **c/o parse** — resolve PM from mailing address when present (high confidence; skips paid fallbacks)
4. **LoopNet** fallback (Apify `memo23/loopnet-scraper-ppe`) — medium confidence
5. **Google search** fallback (Apify `apify/google-search-scraper`) — low confidence, hard-capped at 5000
6. **Contact enrichment waterfall** (company-deduped + persistent cache):
   - getleads.io ($0 marginal on unlimited)
   - AI Ark
   - LeadMagic role finder
   - Google/LinkedIn soft signal

The UI requires an **explicit confirm** after showing a cost estimate. Ambiguous locations (e.g. city without state) must be disambiguated first.

### Cached Shovels commercial contractors (MCP)

A local snapshot of **~6.1k unique commercial contractors** (Dallas / Fort Worth / Rockwall County, permit window in `data/shovels_commercial_contractors/summary.json`) is shipped in-repo and exposed over MCP + HTTP. Querying it does **not** call the Shovels API.

| MCP tool | Behavior |
|----------|----------|
| `pmf_shovels_contractors_summary` | Counts + contact fill only |
| `pmf_shovels_contractors_query` | Paginated rows (max 50/page) |
| `pmf_shovels_contractors_sample` | ≤20 random rows for QA |
| `pmf_shovels_contractors_get` | One row by id |
| `pmf_shovels_contractors_export_csv` | Filtered CSV (cap 5000) |

HTTP mirrors: `/api/shovels/contractors/summary`, `/api/shovels/contractors`, `/sample`, `/export.csv`.

**License note:** Shovels licenses data for internal business use. Agency/client-list use may need explicit vendor confirmation before scale.

## Stack

- Node.js + Express + TypeScript
- React (Vite) single-page UI
- Apify actors via `apify-client`
- Gemini 2.5 Flash-Lite structured JSON via Google's OpenAI-compatible API (`OPENAI_BASE_URL`)
- Supabase Postgres schema `property_pm_finder`
- Railway (Dockerfile + nixpacks)

## Environment variables

Copy `.env.example` → `.env` (or set in Railway):

| Variable | Required | Notes |
|----------|----------|-------|
| `OPENAI_API_KEY` | for live AI | Gemini API key (from maps scraper Railway) |
| `OPENAI_BASE_URL` | no | Default empty; set to `https://generativelanguage.googleapis.com/v1beta/openai/` for Gemini |
| `OPENAI_MODEL` | no | Default `gemini-2.5-flash-lite` |
| `APIFY_TOKEN` | for live scrapes | [Apify Console → Integrations](https://console.apify.com/settings/integrations) |
| `SUPABASE_URL` | for persistence | Same as google-maps-scraper service |
| `SUPABASE_ANON_KEY` | for persistence | Same as google-maps-scraper service |
| `SUPABASE_INGEST_SECRET` | for persistence | Same as google-maps-scraper service (RPC auth) |
| `GETLEADS_API_KEY` | for contacts | Unlimited plan → $0 in cost tracker |
| `GETLEADS_BASE_URL` | no | Default `https://api.getleads.io` |
| `AI_ARK_API_KEY` | optional waterfall | ~$0.0015/people search estimate |
| `AI_ARK_BASE_URL` | no | Default `https://api.ai-ark.com` |
| `LEADMAGIC_API_KEY` | optional waterfall | Role finder ~2 credits ≈ $0.05/match estimate |
| `DEMO_MODE` | no | `true` = synthetic data, no paid calls |
| `LOOPNET_FALLOUT_PCT` | no | Default `0.50` for cost estimates |
| `GOOGLE_SEARCH_HARD_CAP` | no | Default `5000` |
| `PORT` | no | Default `8080` |

### Adding keys on Railway

1. Open the Railway project → service → **Variables**
2. Add `APIFY_TOKEN`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and enrichment keys
3. Redeploy

### Local `.env`

```bash
cp .env.example .env
# edit keys
DEMO_MODE=true npm run dev   # UI smoke test without spending
```

## Supabase schema

Schema SQL lives in [`supabase/schema.sql`](supabase/schema.sql). It is applied on the **google-maps-scraper-leads** project (`kemvxzhcxvynmoutwdrh`) under schema **`property_pm_finder`**:

- `runs` — job metadata, status, cost
- `properties` — owner/PM resolution + raw actor payloads
- `contacts` — decision makers per property
- `pm_company_contact_cache` — cross-run company→contact cache
- `openai_debug_logs` — raw LLM I/O for prompt tuning

On every completed run, contacts are **also mirrored** into the existing Maps-scraper tables:

- `public.scrape_jobs` — one row per PM-finder run (`id = pmf-<run_uuid>`, tags include `property_pm_finder`)
- `public.scrape_leads` — one row per decision-maker contact (name/email/phone/city/state + PM company in `category`, full payload in `raw`)

Writes use the same **anon key + ingest-secret RPC** pattern as the Maps scraper (`ingest_scrape_job` / `ingest_scrape_leads`, plus `ingest_pmf_*` RPCs for the dedicated schema). Existing Maps scrape table definitions are not altered.

Borrow credentials from the Railway project **google maps scraper** → service `google-maps-scraper` → variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_INGEST_SECRET`.

## Local development

```bash
npm install
DEMO_MODE=true npm run dev
# API http://localhost:8080  ·  Vite http://localhost:5173 (proxies /api)
```

Production-style:

```bash
npm run build
DEMO_MODE=true npm start
```

## Small sample test run (recommended before 5000+)

1. Set `DEMO_MODE=false` and real `APIFY_TOKEN` + `OPENAI_API_KEY` (+ Supabase service role)
2. Open the UI
3. Enter: `Get me all commercial property owners in Fort Worth, TX`
4. Set **Sample size override** to `100` (or `25`)
5. Click **Parse & estimate** → review cost band → resolve ambiguity if shown
6. Click **Confirm & run pipeline**
7. Watch live counters; export CSV when complete
8. In Supabase, inspect `property_pm_finder.runs`, `.properties`, `.contacts`, `.openai_debug_logs`

Demo path (no spend):

```bash
DEMO_MODE=true npm start
# same UI flow — uses synthetic Propwire/LoopNet/Google/getleads data
```

## Cost model (estimates)

| Step | Unit estimate |
|------|----------------|
| Propwire full detail | $0.00155 / record |
| Gemini 2.5 Flash-Lite parse | ~$0.0002 / record |
| LoopNet | $0.0015 / record × fallout % |
| Google PM search | $0.0025 / query (cap 5000) |
| getleads | $0 |
| AI Ark people search | ~$0.0015 / lookup |
| LeadMagic role finder | ~$0.05 / successful match |

Apify platform minimums and OpenAI usage are billed by those platforms separately — UI numbers are estimates, not invoices.

## MCP server (Claude)

Full tool access for Claude Desktop / Cursor / remote Claude connectors. See [`mcp/README.md`](mcp/README.md).

| Mode | How |
|------|-----|
| **Claude Desktop (stdio)** | `npm run build && node dist/mcp/stdio.js` — config example in `mcp/claude_desktop_config.example.json` |
| **Remote HTTP** | `POST /mcp` on the Railway URL (no auth) |
| **Health** | `GET /mcp/health` |

Tools: `pmf_health`, `pmf_parse_query`, `pmf_resolve_location`, `pmf_confirm_run` (write/spend), `pmf_get_run`, `pmf_list_runs`, `pmf_get_results`, `pmf_export_csv`, `pmf_estimate_cost`. Prompt: `pmf_run_commercial_pull`.

## API sketch

- `POST /api/runs/parse` `{ query }` → parsed params + estimate + run id
- `POST /api/runs/:id/resolve-location` `{ location_value }`
- `POST /api/runs/:id/confirm` `{ max_records? }` → starts background job
- `GET /api/runs/:id` → live status / cost
- `GET /api/runs/:id/results` → contact-level rows
- `GET /api/runs/:id/export.csv`
- `POST /mcp` → MCP streamable HTTP
- `GET /mcp/health` → MCP tool catalog

## Deploy (Railway)

```bash
railway up -y
railway variables set OPENAI_API_KEY=... APIFY_TOKEN=... \
  SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_INGEST_SECRET=...
railway domain
```


Or connect the GitHub repo in the Railway dashboard and set the same variables.
