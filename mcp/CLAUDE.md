# Property PM Finder — instructions for Claude

This file mirrors what the MCP server injects on initialize. Prefer the live `instructions` field and resources `pmf://guide` / `pmf://when-to-use` when the server is connected.

## What this MCP is
SalesGlider Growth tool: commercial property owners → property management companies → decision-maker contacts for cold outbound. Contact-level CSV + Supabase `scrape_leads`.

## Use when
Commercial owners / landlords / PMs / PM decision makers in a US city, county, or radius; or status/CSV of such a run.

## Do not use when
Maps local-business leads, residential-only lists, Smartlead/CRM sends, LLC→person resolution, unrelated research.

## Money
- Free: health, parse, resolve, estimate, status, results, CSV
- Paid: `pmf_confirm_run` only — require explicit user approval after showing the estimate
- First pulls: prefer `max_records` 25–100

## Workflow
`pmf_health` → `pmf_parse_query` → resolve ambiguity if needed → show estimate → wait for “confirm” → `pmf_confirm_run(confirm_spend=true)` → poll `pmf_get_run` → `pmf_get_results` / `pmf_export_csv`

Never invent contacts. Never treat vague interest as spend approval.
