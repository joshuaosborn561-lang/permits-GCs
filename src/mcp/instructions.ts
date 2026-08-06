/** Shown to Claude on MCP initialize — primary guidance for when/how to use this server. */
export const SERVER_INSTRUCTIONS = `
You are connected to the SalesGlider Property PM Finder MCP.

## What this product does (plain English)
It turns a market request like "commercial property owners in Fort Worth, TX" into an outreach-ready contact list:
property address → owner of record → property management company → decision-maker contact (name/title/email when available).

End goal: contacts for cold outbound (Smartlead later), NOT just a building list. Results are contact-level rows and are also synced into Supabase scrape_leads (same project as the Google Maps scraper).

## When to use this MCP
Use it when the user wants any of:
- Commercial property owners / landlords in a US city, county, or radius
- Property management companies for those properties
- Decision makers at those PM firms (Property Manager, Regional Manager, VP Ops, etc.)
- A CSV/list of those contacts for outbound
- Status/cost of a PM-finder run they already started

## When NOT to use this MCP
Do NOT use it for:
- Residential-only or Google Maps local-business scrapes (different product)
- Sending Smartlead campaigns / CRM writes (out of scope here — export CSV only)
- Resolving LLC owners to individual legal names (Reonomy-style) — out of scope
- Random web research unrelated to commercial property PM contacts

## Hard safety rules (money)
1. pmf_parse_query and pmf_estimate_cost do NOT spend money.
2. pmf_confirm_run SPENDS money (Apify Propwire/LoopNet/Google + OpenAI + optional enrichment).
3. NEVER call pmf_confirm_run until you have shown the cost estimate and the user explicitly says to run/spend/confirm.
4. pmf_confirm_run requires confirm_spend=true. If the user has not approved, do not set it.
5. Default first real pulls to max_records 25–100 unless the user clearly wants a large pull.

## Required workflow
1. pmf_health — warn if demoMode=true or keys missing.
2. pmf_parse_query(query) — get run_id, parsed location, estimate.
3. If parsed.ambiguous=true → ask user to pick from ambiguity_options → pmf_resolve_location.
4. Present estimate (low–high, key assumptions). Wait for explicit approval.
5. pmf_confirm_run(run_id, confirm_spend=true, max_records?).
6. Poll pmf_get_run every few seconds until status is completed or failed.
7. pmf_get_results for a summary; offer pmf_export_csv for the full file.

## Cascade the pipeline runs (so you can explain status)
1. Propwire commercial pull (always)
2. Parse mailing address for c/o → PM high confidence (skips paid fallbacks)
3. LoopNet fallback → medium confidence
4. Google search fallback → low confidence (hard cap 5000)
5. Contact enrichment waterfall for resolved PM companies: getleads ($0) → AI Ark → LeadMagic → Google soft signal
   (deduped by company + cached in Supabase)

## Output shape
Contact-level rows: contact_name, title, email, phone, contact_source, property_manager_company, pm_confidence, pm_source, owner_*, address/city/state/zip.

Prefer summarizing counts by pm_confidence and contact_source. Never invent contacts that tools did not return.

Read resource pmf://guide for the full operator guide.
`.trim();

export const GUIDE_MARKDOWN = `# SalesGlider Property PM Finder — Operator Guide for Claude

## One-sentence purpose
Find commercial property owners and the property managers / decision makers who control those buildings, then export outreach-ready contacts.

## Trigger phrases from the user
- "Get commercial property owners in …"
- "Find PMs / property managers for commercial buildings in …"
- "Pull commercial landlords within 50 miles of …"
- "Export the Fort Worth PM contacts"
- "What's the status of that property pull?"

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
| pmf_get_results | No | Run finished; need contacts table |
| pmf_export_csv | No | User wants a file/CSV |

## Approval script (use this)
After parse/estimate, say something like:
> Estimated cost for N records: $X–$Y.
> Steps covered: Propwire + owner parse + LoopNet/Google fallbacks + contact enrichment.
> Reply **confirm** to start (I recommend starting with 100 records), or give a different sample size.

Only then call pmf_confirm_run with confirm_spend=true.

## Recommended defaults
- First live pull in a market: max_records=100 (or 25 if testing)
- Full market pulls: only when user asks (up to 5000 default parse, hard Google cap 5000)
- Always mention demoMode from pmf_health if true (synthetic data, not real scrapes)

## Interpreting results for the user
- pm_confidence high = from c/o field (best)
- medium = LoopNet
- low = Google
- unresolved = no PM found (or Google cap hit)
- contact_source getleads = $0 marginal; label that for the user
- Soft Google contacts may have name/title only (no email)

## Out of scope
- No Smartlead send from this MCP
- No auth / multi-user
- No LLC→person legal name resolution
- No residential scrapes
`;
