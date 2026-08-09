export const SERVER_INSTRUCTIONS = `
# Permit & Parcel MCP — Claude operating manual

You are connected to **permits-gcs** / Permit & Parcel MCP (SalesGlider; GitHub repo \`permits-GCs\`). Jobs:

1. **Shovels commercial GC contacts** (Dallas / Fort Worth / Rockwall) — cached, free
2. **Appraisal-district commercial parcels** (Dallas DCAD, Tarrant TAD, Collin CCAD)
3. **Operator rollup** by normalised mailing address (\`build_operators\`) — free, first-class
4. **OpenSOS** local-LLC officer lookup — only after estimate + human approval; never bulk-buy

The old Propwire → LoopNet → Google property-owner cascade was **removed**. Do not offer it.

This server is **not** a people-resolver. It surfaces public permit + parcel records. Prefer the name Permit & Parcel over "Property Owners".

## Supabase target (critical)
- Every \`health\` and \`sync_to_supabase\` response includes \`supabase_project\` + \`supabase_schema\`.
- This MCP writes to project **kemvxzhcxvynmoutwdrh** (schema \`permit_parcel\`). The Google Maps Scraper MCP may use a different project — confirm before diagnosing "table missing".

## Context budget (critical)
- Results write **server-to-server** to Supabase via \`sync_to_supabase\` / \`build_operators\`.
- Tool responses return **counts / small pages** only. Never dump thousands of rows into chat.
- After sync, verify with \`select count(*)\` (or the verify_sql the tool returns).

## When to use
- DFW commercial contractor / GC list (Shovels ~6,124)
- Commercial parcel owners from DCAD / TAD / CCAD
- Grouping shell LLCs into real operators by tax-bill mailing address
- Officer / managing-member lookup for **local LLC** parcel owners (OpenSOS, ~$0.03) — sparingly

## When NOT to use
- Google Maps local-business scrapes
- Propwire / LoopNet / residential rolls
- Institutional owners (REIT/fund/trust) — classify and **drop**; do not OpenSOS them
- Bulk OpenSOS / SOSDirect / paid SOS unmasking across tens of thousands of LLCs
- Smartlead sends / CRM writes

## Owner-type routing
\`owner_type\` on parcels:
- \`individual\` → owner is the decision maker (no OpenSOS)
- \`local_llc\` → optional \`opensos_lookup\` after estimate + approval
- \`institutional\` → drop from private-operator outreach
- \`municipal\` → city/county/ISD/housing authority/etc. Different motion; segmentable, not "unknown"

## Free LLC unmasking (do not buy)
OpenSOS ~$0.03/lookup × 60k+ LLCs is thousands of dollars. Do **not**. Same for SOSDirect.
Cheapest path:
1. Filter by \`min_assessed_value\`
2. \`build_operators\` — resolve mailing-address operators, not every entity
3. Join Texas Comptroller **Public Information Report** (Form 05-102) bulk files from the Texas Open Data Portal / Open Records — free
Caveat: registered agents (CT Corporation, law firms) are **not** owners — prefer PIR officer/director fields and filter agent-service patterns. Entity-name match rates vs CAD are messy (~60–80%); budget normalisation.

## Workflows

### Contractors (Shovels)
1. \`permits_contractors_summary\`
2. \`permits_contractors_query\` / \`_sample\` (paginate ≤50)
3. \`sync_to_supabase\` with dataset=contractors (counts only)

### Parcels
1. \`parcels_summary\`
2. \`parcels_query\` (filter county / owner_name / city / zip / use_code / owner_type)
3. \`sync_to_supabase\` with dataset=parcels (full matching set; county filter honoured; natural key county+account_id)
4. \`build_operators\` for mailing-address rollup (counts only)
5. For **local_llc** owners only when needed: \`opensos_estimate\` → show cost → **wait for approval** → \`opensos_lookup(..., confirm_spend=true)\`

### Money / OpenSOS quota
- Shovels + parcels + operators: free (local files + Supabase write)
- OpenSOS: **hard cap 1000 live lookups / UTC month**
- **ALWAYS** call \`opensos_estimate\` first. Never batch-live without approval.

## Tool cheat sheet
| Tool | Spends? | Purpose |
|------|---------|---------|
| health | No | Readiness + supabase_project |
| permits_contractors_* | No | Shovels GCs |
| parcels_* | No | CAD parcels |
| build_operators | No | Mailing-address operator rollup → permit_parcel.operators |
| opensos_usage / estimate | No | Quota / pre-spend |
| opensos_lookup | ~$0.03 live | Officers; needs confirm_spend after approval |
| sync_to_supabase | No | Maps-style S2S sync; counts + supabase_project |
`.trim();

export const GUIDE_MARKDOWN = `# Permit & Parcel MCP — operator guide

## Identity
- **Name:** Permit & Parcel MCP (not a people "Property Owners" resolver)
- **Server:** \`permits-gcs\`
- **Jobs:** Shovels commercial GCs + DCAD/TAD/CCAD commercial parcels + mailing-address operators + gated OpenSOS
- **Supabase:** project reported in \`health\` / sync responses (expect \`kemvxzhcxvynmoutwdrh\` / schema \`permit_parcel\`)
- **Removed:** Propwire / LoopNet / Google owner cascade

## Sync rules
- No silent 50k truncation — full matching set, or fail loudly
- Upsert parcels on \`(county, account_id)\`
- If scrape \`rows_inserted > 0\` but \`permit_parcel_schema_upserted = 0\`, treat as error
- Always prefer sync/build_operators + SQL \`select count(*)\` over dumping rows into chat

## Operators
\`build_operators\` groups by normalised mailing address (strip C/O, ATTN, %, CARE OF). Excludes out-of-state (spelled + 2-letter codes), tax departments, and municipal owners by default.

## Free PIR path
Do not buy OpenSOS/SOSDirect for bulk LLC unmasking. Use Texas Comptroller Public Information Reports after operator rollup. Registered agent ≠ owner.
`;

export const WHEN_TO_USE_MARKDOWN = `# When to use Permit & Parcel MCP

## Yes
- Cached Shovels commercial contractor contacts (~6,124)
- Commercial parcels from Dallas / Tarrant / Collin appraisal districts
- Operator rollup by mailing address (\`build_operators\`)
- OpenSOS officer lookup for **local LLC** owners — after estimate + approval only

## No
- Propwire/LoopNet cascade (removed)
- Maps local businesses
- Institutional fund/REIT owners (drop them)
- Bulk paid SOS unmasking — use operators + free Comptroller PIR
- Bulk row dumps through chat — use sync_to_supabase

## Money
Parcels + Shovels + operators are free. OpenSOS ~$0.03/lookup — confirm before live calls; monthly cap 1000.
`;
