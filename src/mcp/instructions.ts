/** Shown to Claude on MCP initialize — primary guidance for when/how to use this server. */
export const SERVER_INSTRUCTIONS = `
# SalesGlider Property PM Finder MCP — Claude operating manual

You are connected to **property-pm-finder**. This is a SalesGlider Growth lead tool. Treat it as a specialist — not a general search engine.

## Two jobs this MCP does

### A) Commercial property → PM → decision-maker pipeline (paid)
Natural language market request → commercial properties → owner of record → property management company → decision-maker contact → CSV + Supabase.

### B) Cached Shovels commercial contractor file (~6,124 / "~6400" GCs) — FREE
This MCP **already contains** the DFW commercial contractor contact dataset people call the "6400 contractor file" / "Shovels GC list" / \`commercial_contractors_contacts.csv\`.

- **Exact count:** 6,124 unique commercial contractors (Dallas 4,279 + Fort Worth 2,192 + Rockwall County 29; some multi-place)
- **Fields:** company/name, phone (~88%), email (~89%), website, address, permit activity tags
- **Not a filesystem path Claude can browse.** Access via tools/resources below. Do **not** say the file is missing.
- **No Shovels API spend** — local cache only.

**If the user asks for the contractor file / 6400 list / Shovels GCs:**
1. Read resource \`pmf://shovels-contractors\` (or call \`pmf_shovels_contractors_summary\`)
2. Query/sample with \`pmf_shovels_contractors_query\` / \`_sample\` (paginate; never dump all rows into chat)
3. For a downloadable CSV: \`pmf_shovels_contractors_export_csv\` (or HTTP \`/api/shovels/contractors/export.csv\`)

## Decision tree: should I use this MCP?

USE THIS MCP when the user wants any of:
- Commercial property owners / landlords / building owners in a US city, county, radius, or ZIP list
- Property management companies (PMs) tied to those commercial properties
- Decision makers at those PM firms (Property Manager, Regional Manager, Director/VP Ops, etc.)
- An outreach list / CSV of those contacts for cold outbound (Smartlead later)
- Status, cost, or results of a PM-finder run already started here
- **The ~6,124 / "~6400" Shovels commercial contractor contact file** (Dallas / Fort Worth / Rockwall) — company, phone, email

Geography rules (property pipeline):
- Optional \`zips\` (comma-separated) on \`pmf_parse_query\` / \`pmf_estimate_cost\` wins outright and is persisted for \`pmf_confirm_run\`.
- "Within N miles of X" → \`center\` + \`radius_miles\`; ZIP footprint is resolved via haversine on \`data/us_zipcodes.csv\`. Keep states to the center's state (DFW radius → TX only, not OK).
- \`exclude_categories\` honors "do not include …" phrasing in the brief.
- CSV export includes \`latitude\` / \`longitude\`; optional center+radius_miles filters post-hoc.

Do NOT use this MCP when the user wants:
- **Google Maps** local-business / restaurant / Maps-category contractor scrapes (different product: google-maps-scraper). The **Shovels commercial GC file is NOT that** — it IS in this MCP.
- Residential-only owner lists
- Sending email / Smartlead campaigns / CRM writes from chat (export CSV only — campaign send is out of scope)
- Resolving LLC owners to individual legal persons (Reonomy-style) — out of scope
- Generic web research, news, or unrelated scraping

If the request is ambiguous between Maps businesses and commercial property owners, ASK which they mean before spending.
If they ask for "contractors" / "GCs" / "6400 list" / "Shovels file", use the **Shovels contractor tools** — do not refuse and do not start the paid Propwire pipeline unless they also want property owners.

## What the property pipeline actually does (so you can explain it)
1. **Propwire** — pull commercial properties + owner mailing data for the market
2. **c/o parse (OpenAI)** — if mailing has "c/o …", treat that as PM (**high** confidence) and skip paid PM fallbacks
3. **LoopNet** — PM fallback (**medium**)
4. **Google search** — last PM fallback (**low**); hard cap 5000 Google lookups
5. **Contact enrichment** for unique PM companies (cached in Supabase):
   getleads ($0) → AI Ark → LeadMagic → Google soft signal (name/title may lack email)

Output is **contact-level** rows, not just buildings. Results also sync into Supabase \`scrape_leads\` (same project as the Google Maps scraper).

## Hard safety rules (money) — never violate
1. \`pmf_parse_query\`, \`pmf_estimate_cost\`, \`pmf_resolve_location\`, status/results/export tools, and **all \`pmf_shovels_contractors_*\` tools** do **NOT** spend money.
2. \`pmf_confirm_run\` **SPENDS** money (Apify + OpenAI + optional enrichment APIs).
3. **NEVER** call \`pmf_confirm_run\` until you have shown the cost estimate AND the user explicitly approved (e.g. "confirm", "run it", "go ahead", "spend it").
4. \`confirm_spend\` must be the boolean \`true\` only after that approval. Do not invent approval from vague interest ("look into Fort Worth", "curious what we'd get").
5. Default first live pulls to \`max_records\` **25–100** unless the user clearly wants a large/full pull.
6. If \`pmf_health\` shows \`demoMode=true\`, warn: results are synthetic / not real scrapes.

## Required workflow — property pull (paid)
1. Prefer reading resource \`pmf://guide\` once per session (or when unsure).
2. \`pmf_health\` — warn on demoMode or missing keys.
3. \`pmf_parse_query(query)\` — get \`run_id\`, parsed location, estimate. Free.
4. If \`ambiguous=true\` → ask user to pick from \`ambiguity_options\` → \`pmf_resolve_location\`. Never guess the city silently.
5. Present estimate: \$low–\$high, location, record cap, short assumptions. Ask for explicit spend approval. Recommend 100 records for a first pull.
6. Only then \`pmf_confirm_run(run_id, confirm_spend=true, max_records?)\`.
7. Poll \`pmf_get_run\` every few seconds until \`completed\` or \`failed\`.
8. \`pmf_get_results\` for summary; offer \`pmf_export_csv\` for the full file.
9. Never invent contacts, emails, or PM companies the tools did not return.

## Required workflow — Shovels contractor file (free)
1. Read \`pmf://shovels-contractors\` or call \`pmf_shovels_contractors_summary\`.
2. Tell the user the file is loaded (unique_contractors ≈ 6124) and fill rates.
3. Search with \`pmf_shovels_contractors_query\` (page_size ≤ 50) or spot-check with \`_sample\` (≤ 20).
4. Export with \`pmf_shovels_contractors_export_csv\` when they want the CSV (cap 5000 per call; filter by place first if needed).
5. **Never** dump all ~6k rows into chat.

## How to talk to the user after parse
Use language like:
> Estimated cost for ~N commercial records in {location}: **\$X–\$Y**.
> Pipeline: Propwire → owner/c/o parse → LoopNet/Google PM fallbacks → contact enrichment (getleads free first).
> Reply **confirm** to start (I recommend 100 records first), or tell me a different sample size.

## How to summarize results
- Counts by \`pm_confidence\`: high (c/o), medium (LoopNet), low (Google), unresolved
- Counts by \`contact_source\`: getleads (\$0), ai_ark, leadmagic, google_search, cache
- Mention unresolved PMs and soft Google contacts (name/title may have no email)
- Offer CSV export for Smartlead import

## Tool cheat sheet
| Tool | Spends? | Purpose |
|------|---------|---------|
| pmf_health | No | Readiness / demoMode / shovels_contractors_loaded |
| pmf_parse_query | No | NL → run + estimate |
| pmf_resolve_location | No | Fix ambiguous location |
| pmf_estimate_cost | No | What-if without a run |
| pmf_confirm_run | **YES** | Start paid pipeline |
| pmf_get_run | No | Live status |
| pmf_list_runs | No | Find past runs |
| pmf_get_results | No | Contact rows |
| pmf_export_csv | No | Full CSV text |
| pmf_shovels_contractors_summary | No | **THE ~6400 contractor file** — counts/fill (no rows) |
| pmf_shovels_contractors_query | No | Paginated Shovels GC contacts (max 50/page) |
| pmf_shovels_contractors_sample | No | ≤20 random Shovels GC rows for QA |
| pmf_shovels_contractors_get | No | One Shovels GC by id |
| pmf_shovels_contractors_export_csv | No | Filtered Shovels GC CSV (cap 5000) |

### Shovels contractor dataset rules
- Source: commercial contractors with recent permit activity (Dallas, Fort Worth, Rockwall County).
- File aliases users may say: "6400 contractors", "6k GCs", "Shovels commercial contractors CSV", \`commercial_contractors_contacts.csv\`.
- **Summary tools return counts. Query/sample paginate. Never dump all ~6k rows into the model context.**
- License note: Shovels data is licensed for internal business use; agency/client-list use may need vendor confirmation before scale.

## Resources
- \`pmf://guide\` — full operator guide
- \`pmf://when-to-use\` — quick yes/no
- \`pmf://shovels-contractors\` — **index for the ~6124 contractor file** (start here for GC list questions)

## Prompts available
- \`pmf_run_commercial_pull\` — full estimate→approve→run→results flow
- \`pmf_check_run_status\` — status / progress for an existing run
- \`pmf_export_contacts\` — fetch + CSV for a completed run
- \`pmf_query_shovels_contractors\` — use the cached ~6124 commercial contractor file

If unsure whether to spend money: parse/estimate first, ask the human, then confirm.
`.trim();

export const GUIDE_MARKDOWN = `# SalesGlider Property PM Finder — Full operator guide for Claude

## Identity
- **Product name:** Property PM Finder (SalesGlider Growth)
- **MCP server name:** \`property-pm-finder\`
- **Jobs:** (1) Commercial property owner → property manager → decision-maker contacts; (2) **cached Shovels commercial contractor file (~6,124 rows / "~6400")**
- **Not:** Google Maps local-business scraper, Smartlead sender, or LLC→person resolver

## Trigger phrases (use this MCP)
### Property / PM pipeline
- "Get commercial property owners in …"
- "Find property managers / PMs for commercial buildings in …"
- "Pull commercial landlords within 50 miles of …"
- "Who manages commercial properties in …?"
- "Export the Fort Worth PM contacts"
- "What's the status of that property pull?"
- "How much would 500 commercial owners in Dallas cost?"

### Shovels commercial contractor file (FREE — already loaded)
- "Where is the 6400 contractor file?"
- "Show / query / export the Shovels commercial contractors"
- "DFW commercial GCs with email/phone"
- "commercial_contractors_contacts.csv"
- "How many contractors do we have from Shovels?"

→ Start with resource \`pmf://shovels-contractors\` or tool \`pmf_shovels_contractors_summary\`. The file is **not** a path on Claude's disk; it is this dataset.

## Anti-trigger phrases (do NOT use this MCP)
- "Find HVAC / restaurants / contractors **on Google Maps**" (Maps scraper — different product)
- "Send this list in Smartlead"
- "Resolve this LLC to the real person"
- "Scrape residential homeowners"

**Note:** Asking for "contractors" / "GCs" / "6400 list" without "Google Maps" → **USE** the Shovels tools in this MCP. Do not refuse.

## Tool map

| Tool | Spends $? | Use when |
|------|-----------|----------|
| pmf_health | No | Start of a session / before a paid run; also shows \`shovels_contractors_loaded\` |
| pmf_parse_query | No | User described a market in natural language |
| pmf_resolve_location | No | Parse returned ambiguous=true |
| pmf_estimate_cost | No | What-if sizing without creating a run |
| pmf_confirm_run | **YES** | User explicitly approved the estimate |
| pmf_get_run | No | Monitoring a running/completed job |
| pmf_list_runs | No | "What runs do we have?" |
| pmf_get_results | No | Run finished; need contacts table |
| pmf_export_csv | No | User wants a file/CSV from a PM-finder run |
| pmf_shovels_contractors_summary | No | Counts for the ~6124 contractor file |
| pmf_shovels_contractors_query | No | Search/filter contractor rows (≤50/page) |
| pmf_shovels_contractors_sample | No | ≤20 random rows for QA |
| pmf_shovels_contractors_get | No | One contractor by Shovels id |
| pmf_shovels_contractors_export_csv | No | Download/filtered CSV of the contractor file |

## Spend-safe workflow (mandatory for property pulls)
1. \`pmf_health\`
2. \`pmf_parse_query\` (creates run in \`awaiting_confirmation\`, no spend)
3. Resolve ambiguity if needed
4. Show estimate → **wait for explicit human approval**
5. \`pmf_confirm_run\` with \`confirm_spend=true\` (and usually \`max_records=100\`)
6. Poll \`pmf_get_run\`
7. \`pmf_get_results\` / \`pmf_export_csv\`

## Approval script
> Estimated cost for N records: \$X–\$Y.
> Steps: Propwire + owner parse + LoopNet/Google fallbacks + contact enrichment.
> Reply **confirm** to start (recommend 100 records), or give a different sample size.

Only then call \`pmf_confirm_run\`.

## Cascade explained for status updates
While \`status=running\`, \`current_step\` may show stages like Propwire pull, c/o parse, LoopNet, Google, contact enrichment. Report progress counters when present. Do not claim completion until \`status\` is \`completed\` or \`failed\`.

## Interpreting fields
- \`pm_confidence\` high = from mailing c/o (best)
- medium = LoopNet
- low = Google
- unresolved = no PM found (or Google cap)
- \`contact_source\` getleads = \$0 marginal cost — call that out
- Google soft contacts may be name/title only (no email)
- Rows are contact-level; one property can yield multiple contacts or none

## Recommended defaults
- First live pull in a market: \`max_records=100\` (or 25 if testing)
- Full market: only when user asks (parse default can be up to 5000; Google PM lookups hard-capped at 5000)
- Always surface \`demoMode\` from health if true

## Persistence
- In-memory job store on the Railway service (recent runs via \`pmf_list_runs\`)
- Successful runs sync into Supabase \`scrape_jobs\` / \`scrape_leads\` (Maps scraper project)
- Shovels contractor CSV ships in the deploy at \`data/shovels_commercial_contractors/commercial_contractors_contacts.csv\` and is loaded into memory at boot

## Out of scope
- No Smartlead send
- No multi-user auth on MCP HTTP
- No LLC→person legal name resolution
- No residential scrapes
- No live Shovels API pulls from these tools (cache only)
`;

export const WHEN_TO_USE_MARKDOWN = `# When to use Property PM Finder

## Yes — use now
1. Commercial property **owners**, **property managers**, or **PM decision-maker contacts** for a US market, or status/CSV of such a run.
2. **The ~6,124 / "~6400" Shovels commercial contractor contact file** (Dallas / Fort Worth / Rockwall) — query, sample, or export CSV. Free. Resource: \`pmf://shovels-contractors\`.

## No — wrong tool
Google Maps / local-business scrapes (including Maps-category "contractors"), residential owners, sending campaigns, LLC person resolution, unrelated research.

**Exception:** Shovels commercial GCs / "6400 contractor file" **are in scope** here — not Maps.

## Money gate
Parse & estimate are free. Confirming a property-pipeline run spends money. Never confirm without explicit user approval after showing the estimate.
All \`pmf_shovels_contractors_*\` tools are free (local cache).
`;

/** Resource text for the "6400 contractor file" index Claude should open first. */
export const SHOVELS_CONTRACTORS_RESOURCE = `# Shovels commercial contractor file (~6,124 / "~6400")

This **is** the contractor file. It is loaded on this MCP server — not a separate disk path for Claude to open.

## Facts
- **Unique contractors:** 6,124 (often referred to as "~6400")
- **Source:** Shovels.ai commercial permit activity
- **Geos:** Dallas (4,279), Fort Worth (2,192), Rockwall County (29); some appear in multiple places
- **Date window:** 2025-08-01 → 2026-08-07
- **Filter:** property_type=commercial
- **Ship path in repo/deploy:** \`data/shovels_commercial_contractors/commercial_contractors_contacts.csv\`
- **HTTP CSV:** \`GET /api/shovels/contractors/export.csv\`
- **Cost:** free (cached; no Shovels API call)

## How to access (tools)
1. \`pmf_shovels_contractors_summary\` — counts + phone/email fill rates (start here)
2. \`pmf_shovels_contractors_query\` — search/filter, max 50 rows per page
3. \`pmf_shovels_contractors_sample\` — ≤20 random rows for QA
4. \`pmf_shovels_contractors_get\` — one row by Shovels id
5. \`pmf_shovels_contractors_export_csv\` — filtered CSV payload (cap 5000)

## Rules for Claude
- If the user asks "where's the 6400 contractor file?" → answer that it is **this dataset** and call summary.
- Do **not** claim the file is missing.
- Do **not** dump all ~6k rows into chat; paginate or export.
- Do **not** refuse because of "contractor" wording — that anti-trigger is for **Google Maps** scrapes only.
`;
