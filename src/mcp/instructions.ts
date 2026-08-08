/** Shown to Claude on MCP initialize — primary guidance for when/how to use this server. */
export const SERVER_INSTRUCTIONS = `
# SalesGlider Property PM Finder MCP — Claude operating manual

You are connected to **property-pm-finder**. This is a paid lead-generation pipeline for SalesGlider Growth outbound. Treat it as a specialist tool, not a general search engine.

## One-line purpose
Natural language market request → commercial properties → owner of record → property management company → decision-maker contact (name/title/email) → CSV + Supabase scrape_leads.

## Decision tree: should I use this MCP?

USE THIS MCP when the user wants any of:
- Commercial property owners / landlords / building owners in a US city, county, radius, or ZIP list
- Property management companies (PMs) tied to those commercial properties
- Decision makers at those PM firms (Property Manager, Regional Manager, Director/VP Ops, etc.)
- An outreach list / CSV of those contacts for cold outbound (Smartlead later)
- Status, cost, or results of a PM-finder run already started here
- **Cached Shovels commercial contractor contacts** for Dallas / Fort Worth / Rockwall County (company name, phone, email) — free local dataset, no Shovels API spend

Geography rules:
- Optional \`zips\` (comma-separated) on \`pmf_parse_query\` / \`pmf_estimate_cost\` wins outright and is persisted for \`pmf_confirm_run\`.
- "Within N miles of X" → \`center\` + \`radius_miles\`; ZIP footprint is resolved via haversine on \`data/us_zipcodes.csv\`. Keep states to the center's state (DFW radius → TX only, not OK).
- \`exclude_categories\` honors "do not include …" phrasing in the brief.
- CSV export includes \`latitude\` / \`longitude\`; optional center+radius_miles filters post-hoc.

Do NOT use this MCP when the user wants:
- Google Maps / local-business / restaurant / contractor leads (different product: google-maps-scraper)
- Residential-only owner lists
- Sending email / Smartlead campaigns / CRM writes from chat (export CSV only — campaign send is out of scope)
- Resolving LLC owners to individual legal persons (Reonomy-style) — out of scope
- Generic web research, news, or unrelated scraping

If the request is ambiguous between Maps businesses and commercial property owners, ASK which they mean before spending.

## What the pipeline actually does (so you can explain it)
1. **Propwire** — pull commercial properties + owner mailing data for the market
2. **c/o parse (OpenAI)** — if mailing has "c/o …", treat that as PM (**high** confidence) and skip paid PM fallbacks
3. **LoopNet** — PM fallback (**medium**)
4. **Google search** — last PM fallback (**low**); hard cap 5000 Google lookups
5. **Contact enrichment** for unique PM companies (cached in Supabase):
   getleads ($0) → AI Ark → LeadMagic → Google soft signal (name/title may lack email)

Output is **contact-level** rows, not just buildings. Results sync into Supabase \`property_pm_finder.*\` and \`public.scrape_leads\` (same project as the Google Maps scraper).

## Context budget (critical)
- getleads / enrichment writes are **server-to-server**. Do **not** pull full result sets into chat and re-insert via Supabase MCP.
- After a run: call \`pmf_sync_to_supabase\` → report **counts only** → verify with \`select count(*)\` (or \`pmf_sync_counts\`).
- \`pmf_get_results\` is a tiny QA sample (≤50). Prefer sync + SQL counts for anything bulk.

## Hard safety rules (money) — never violate
1. \`pmf_parse_query\`, \`pmf_estimate_cost\`, \`pmf_resolve_location\`, status/sync/results tools do **NOT** spend money.
2. \`pmf_confirm_run\` **SPENDS** money (Apify + OpenAI + optional enrichment APIs).
3. **NEVER** call \`pmf_confirm_run\` until you have shown the cost estimate AND the user explicitly approved (e.g. "confirm", "run it", "go ahead", "spend it").
4. \`confirm_spend\` must be the boolean \`true\` only after that approval. Do not invent approval from vague interest ("look into Fort Worth", "curious what we'd get").
5. Default first live pulls to \`max_records\` **25–100** unless the user clearly wants a large/full pull.
6. If \`pmf_health\` shows \`demoMode=true\`, warn: results are synthetic / not real scrapes.

## Required workflow (always)
1. Prefer reading resource \`pmf://guide\` once per session (or when unsure).
2. \`pmf_health\` — warn on demoMode or missing keys.
3. \`pmf_parse_query(query)\` — get \`run_id\`, parsed location, estimate. Free.
4. If \`ambiguous=true\` → ask user to pick from \`ambiguity_options\` → \`pmf_resolve_location\`. Never guess the city silently.
5. Present estimate: \$low–\$high, location, record cap, short assumptions. Ask for explicit spend approval. Recommend 100 records for a first pull.
6. Only then \`pmf_confirm_run(run_id, confirm_spend=true, max_records?)\`.
7. Poll \`pmf_get_run\` every few seconds until \`completed\` or \`failed\`.
8. \`pmf_sync_to_supabase(run_id)\` — server writes to Supabase; you only get counts + \`verify_sql\`.
9. Run those \`select count(*)\` statements (Supabase MCP). Do **not** dump rows into chat.
10. Never invent contacts, emails, or PM companies the tools did not return.

## How to talk to the user after parse
Use language like:
> Estimated cost for ~N commercial records in {location}: **\$X–\$Y**.
> Pipeline: Propwire → owner/c/o parse → LoopNet/Google PM fallbacks → contact enrichment (getleads free first).
> Reply **confirm** to start (I recommend 100 records first), or tell me a different sample size.

## How to summarize results
- Prefer \`pmf_sync_to_supabase\` / \`pmf_sync_counts\` numbers over row dumps
- Counts by \`contact_source\` from sync payload (\`contacts_by_source\`) — note getleads=\$0
- Mention unresolved PMs from run progress counters
- CSV lives in \`scrape_exports\` after sync; avoid pasting CSV into chat

## Tool cheat sheet
| Tool | Spends? | Purpose |
|------|---------|---------|
| pmf_health | No | Readiness / demoMode |
| pmf_parse_query | No | NL → run + estimate |
| pmf_resolve_location | No | Fix ambiguous location |
| pmf_estimate_cost | No | What-if without a run |
| pmf_confirm_run | **YES** | Start paid pipeline |
| pmf_get_run | No | Live status |
| pmf_list_runs | No | Find past runs |
| pmf_sync_to_supabase | No | **Maps-style sync** — counts only |
| pmf_sync_counts | No | \`select count(*)\` style verify |
| pmf_get_results | No | Tiny QA sample (≤50 rows) |
| pmf_export_csv | No | Full CSV text (avoid for bulk) |
| pmf_shovels_contractors_summary | No | Cached Shovels GC counts/fill (no rows) |
| pmf_shovels_contractors_query | No | Paginated Shovels GC contacts (max 50/page) |
| pmf_shovels_contractors_sample | No | ≤20 random Shovels GC rows for QA |
| pmf_shovels_contractors_get | No | One Shovels GC by id |
| pmf_shovels_contractors_export_csv | No | Filtered Shovels GC CSV (cap 5000) |

### Shovels contractor dataset rules
- Source: commercial contractors with recent permit activity (Dallas, Fort Worth, Rockwall County).
- **Summary tools return counts. Query/sample paginate. Never dump all ~6k rows into the model context.**
- License note: Shovels data is licensed for internal business use; agency/client-list use may need vendor confirmation before scale.

## Prompts available
- \`pmf_run_commercial_pull\` — full estimate→approve→run→results flow
- \`pmf_check_run_status\` — status / progress for an existing run
- \`pmf_export_contacts\` — fetch + CSV for a completed run

If unsure whether to spend money: parse/estimate first, ask the human, then confirm.
`.trim();

export const GUIDE_MARKDOWN = `# SalesGlider Property PM Finder — Full operator guide for Claude

## Identity
- **Product name:** Property PM Finder (SalesGlider Growth)
- **MCP server name:** \`property-pm-finder\`
- **Job:** Commercial property owner → property manager → decision-maker contacts for outbound
- **Not:** Maps local-business scraper, Smartlead sender, or LLC→person resolver

## Trigger phrases (use this MCP)
- "Get commercial property owners in …"
- "Find property managers / PMs for commercial buildings in …"
- "Pull commercial landlords within 50 miles of …"
- "Who manages commercial properties in …?"
- "Export the Fort Worth PM contacts"
- "What's the status of that property pull?"
- "How much would 500 commercial owners in Dallas cost?"

## Anti-trigger phrases (do NOT use this MCP)
- "Find HVAC / restaurants / contractors on Google Maps"
- "Send this list in Smartlead"
- "Resolve this LLC to the real person"
- "Scrape residential homeowners"

## Tool map

| Tool | Spends $? | Use when |
|------|-----------|----------|
| pmf_health | No | Start of a session / before a paid run |
| pmf_parse_query | No | User described a market in natural language |
| pmf_resolve_location | No | Parse returned ambiguous=true |
| pmf_estimate_cost | No | What-if sizing without creating a run |
| pmf_confirm_run | **YES** | User explicitly approved the estimate |
| pmf_get_run | No | Monitoring a running/completed job |
| pmf_list_runs | No | "What runs do we have?" |
| pmf_sync_to_supabase | No | Persist run server-to-server; **counts only** |
| pmf_sync_counts | No | Verify with count(*) style JSON |
| pmf_get_results | No | Tiny QA sample only (≤50) |
| pmf_export_csv | No | CSV text (avoid for bulk — use sync) |

## Spend-safe workflow (mandatory)
1. \`pmf_health\`
2. \`pmf_parse_query\` (creates run in \`awaiting_confirmation\`, no spend)
3. Resolve ambiguity if needed
4. Show estimate → **wait for explicit human approval**
5. \`pmf_confirm_run\` with \`confirm_spend=true\` (and usually \`max_records=100\`)
6. Poll \`pmf_get_run\`
7. \`pmf_sync_to_supabase\` → verify with \`select count(*)\` / \`pmf_sync_counts\`
8. Optional tiny QA via \`pmf_get_results\` (limit ≤20) — never bulk row dumps

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

## Out of scope
- No Smartlead send
- No multi-user auth on MCP HTTP
- No LLC→person legal name resolution
- No residential scrapes
`;

export const WHEN_TO_USE_MARKDOWN = `# When to use Property PM Finder

## Yes — use now
User wants commercial property **owners**, **property managers**, or **PM decision-maker contacts** for a US market, or status/sync of such a run.

## No — wrong tool
Maps/local business leads, residential owners, sending campaigns, LLC person resolution, unrelated research.

## Money gate
Parse & estimate are free. Confirming a run spends money. Never confirm without explicit user approval after showing the estimate.

## Context gate
After a run, use \`pmf_sync_to_supabase\` (server-to-server) and only \`select count(*)\`. Do not hand-insert getleads/contact rows through chat.
`;
