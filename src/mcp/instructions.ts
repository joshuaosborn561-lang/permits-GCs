export const SERVER_INSTRUCTIONS = `
# Permit & Parcel MCP — Claude operating manual

You are connected to **permits-gcs** / Permit & Parcel MCP (SalesGlider; GitHub repo \`permits-GCs\`). Jobs:

1. **Shovels commercial GC contacts** (Dallas / Fort Worth / Rockwall) — cached, free
2. **Shovels API credit estimates** — answer "how many credits would this cost?"
3. **Calling lists in Supabase** — persist pulls so Cayden (or anyone) can filter them for cold calling
4. **Appraisal-district commercial parcels** (Dallas DCAD, Tarrant TAD, Collin CCAD)
5. **Operator rollup** by normalised mailing address (\`build_operators\`) — free

The old Propwire → LoopNet → Google property-owner cascade was **removed**. Do not offer it.

This server is **not** a people-resolver. It surfaces public permit + parcel records. Prefer the name Permit & Parcel over "Property Owners".

## Supabase target (critical)
- Every \`health\` and \`sync_to_supabase\` / \`save_calling_list\` response includes \`supabase_project\` + \`supabase_schema\`.
- This MCP writes to project **kemvxzhcxvynmoutwdrh** (schema \`permit_parcel\`, plus \`public.scrape_leads\`). Confirm before diagnosing "table missing".

## Context budget (critical)
- Results write **server-to-server** to Supabase via \`save_calling_list\` / \`sync_to_supabase\` / \`build_operators\`.
- Tool responses return **counts / small pages** only. Never dump thousands of rows into chat.
- After sync, verify with \`select count(*)\` (or the verify_sql the tool returns).

## When to use
- DFW commercial contractor / GC list (Shovels ~6,124)
- "How many Shovels API credits would this pull cost?"
- Save a pull so Cayden can filter a cold-calling list later
- Commercial parcel owners from DCAD / TAD / CCAD
- Grouping shell LLCs into real operators by tax-bill mailing address

## When NOT to use
- Google Maps local-business scrapes
- Propwire / LoopNet / residential rolls
- Institutional owners (REIT/fund/trust) — classify and **drop**
- Paid SOS / officer-unmasking lookups
- Smartlead sends / CRM writes

## Owner-type routing
\`owner_type\` on parcels:
- \`individual\` → owner is the decision maker
- \`local_llc\` → use \`build_operators\` + free Texas Comptroller PIR
- \`institutional\` → drop from private-operator outreach
- \`municipal\` → city/county/ISD/housing authority/etc. Different motion; segmentable, not "unknown"

## Shovels credits (always estimate when asked)
Paid Shovels rule: **1 credit = 1 record returned**.
This MCP reads a **local cached file** — \`shovels_estimate_credits\` reports:
- \`credits.cached_query\` = **0** (what these tools actually spend)
- \`credits.live_shovels_api\` = matching record count (what a live Shovels API pull would bill)

If the user asks for an estimate, call \`shovels_estimate_credits\` and show both numbers. Do not invent credit math.

## Workflows

### Contractors (Shovels) + calling lists
1. If they ask cost/credits → \`shovels_estimate_credits\`
2. \`permits_contractors_summary\` / query / sample (paginate ≤50)
3. \`save_calling_list\` with \`owner\` (e.g. \`cayden\`) — writes Supabase
4. Later: \`list_calling_lists(owner=cayden)\` → \`query_calling_list(has_phone=true)\`

### Parcels
1. \`parcels_summary\`
2. \`parcels_query\` (filter county / owner_name / city / zip / use_code / owner_type)
3. \`sync_to_supabase\` with dataset=parcels
4. \`build_operators\` for mailing-address rollup (counts only)

## Tool cheat sheet
| Tool | Spends Shovels credits? | Purpose |
|------|-------------------------|---------|
| health | No | Readiness + supabase_project |
| shovels_estimate_credits | No | Cached=0 vs live API=1/record |
| permits_contractors_* | No | Shovels GCs (local file) |
| save_calling_list | No | Persist pull → Supabase for Cayden |
| list_calling_lists | No | Saved lists by owner/name |
| query_calling_list | No | Filter a saved list (phone/city/q) |
| parcels_* | No | CAD parcels |
| build_operators | No | Mailing-address operator rollup |
| sync_to_supabase | No | S2S sync; contractor syncs also catalog a calling list |
`.trim();

export const GUIDE_MARKDOWN = `# Permit & Parcel MCP — operator guide

## Identity
- **Name:** Permit & Parcel MCP (not a people "Property Owners" resolver)
- **Server:** \`permits-gcs\`
- **Jobs:** Shovels commercial GCs + credit estimates + Supabase calling lists + DCAD/TAD/CCAD parcels + mailing-address operators
- **Supabase:** project reported in \`health\` / sync responses (expect \`kemvxzhcxvynmoutwdrh\` / schema \`permit_parcel\`)
- **Removed:** Propwire / LoopNet / Google owner cascade

## Shovels credits
1 credit = 1 record on paid Shovels. Local cache queries cost 0. Always use \`shovels_estimate_credits\` when the user asks.

## Calling lists (Cayden)
\`save_calling_list\` writes \`public.scrape_leads\` + \`permit_parcel.calling_lists\`. Filter later with \`list_calling_lists\` / \`query_calling_list\`. Set \`owner=cayden\` so his lists are easy to find. Prefer \`has_phone=true\` for dialing.

## Sync rules
- No silent 50k truncation — full matching set, or fail loudly
- Upsert parcels on \`(county, account_id)\`
- If scrape \`rows_inserted > 0\` but \`permit_parcel_schema_upserted = 0\`, treat as error
- Always prefer sync/save + SQL \`select count(*)\` over dumping rows into chat

## Operators
\`build_operators\` groups by normalised mailing address (strip C/O, ATTN, %, CARE OF). Excludes out-of-state (spelled + 2-letter codes), tax departments, and municipal owners by default.

## Free PIR path
Do not buy paid SOS unmasking for bulk LLCs. Use Texas Comptroller Public Information Reports after operator rollup. Registered agent ≠ owner.
`;

export const WHEN_TO_USE_MARKDOWN = `# When to use Permit & Parcel MCP

## Yes
- Cached Shovels commercial contractor contacts (~6,124)
- Estimate Shovels API credits for a filter
- Save / filter cold-calling lists in Supabase (Cayden or anyone)
- Commercial parcels from Dallas / Tarrant / Collin appraisal districts
- Operator rollup by mailing address (\`build_operators\`)

## No
- Propwire/LoopNet cascade (removed)
- Maps local businesses
- Institutional fund/REIT owners (drop them)
- Bulk row dumps through chat — use save_calling_list / sync_to_supabase

## Money
Parcels + cached Shovels + operators + calling-list writes are free (0 Shovels credits). A live Shovels API pull would cost 1 credit per record — \`shovels_estimate_credits\` reports that number without spending.
`;
