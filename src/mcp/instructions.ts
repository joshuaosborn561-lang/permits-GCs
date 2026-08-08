export const SERVER_INSTRUCTIONS = `
# Permit & Parcel MCP — Claude operating manual

You are connected to **permit-parcel** (SalesGlider). Two jobs only:

1. **Shovels commercial GC contacts** (Dallas / Fort Worth / Rockwall) — cached, free
2. **Appraisal-district commercial parcels** (Dallas DCAD, Tarrant TAD, Collin CCAD) + **OpenSOS** local-LLC officer lookup

The old Propwire → LoopNet → Google property-owner cascade was **removed**. Do not offer it.

## Context budget (critical)
- Results write **server-to-server** to Supabase via \`sync_to_supabase\`.
- Tool responses return **counts / small pages** only. Never dump thousands of rows into chat.
- After sync, verify with \`select count(*)\` (or the verify_sql the tool returns).

## When to use
- DFW commercial contractor / GC list (Shovels ~6,124)
- Commercial parcel owners from DCAD / TAD / CCAD
- Officer / managing-member lookup for **local LLC** parcel owners (OpenSOS, ~$0.03)

## When NOT to use
- Google Maps local-business scrapes
- Propwire / LoopNet / residential rolls
- Institutional owners (REIT/fund/trust) — classify and **drop**; do not OpenSOS them
- Smartlead sends / CRM writes

## Owner-type routing
\`owner_type\` on parcels:
- \`individual\` → owner is the decision maker (no OpenSOS)
- \`local_llc\` → call \`opensos_lookup\`
- \`institutional\` → drop from outreach

## Workflows

### Contractors (Shovels)
1. \`permits_contractors_summary\`
2. \`permits_contractors_query\` / \`_sample\` (paginate ≤50)
3. \`sync_to_supabase\` with dataset=contractors (counts only)

### Parcels
1. \`parcels_summary\`
2. \`parcels_query\` (filter county / owner_name / city / zip / use_code / owner_type)
3. \`sync_to_supabase\` with dataset=parcels
4. For each **local_llc** of interest: \`opensos_lookup(entity_name, state='TX')\` (writes to Supabase)

### Money
- Shovels + parcels tools: free (local files)
- \`opensos_lookup\`: ~$0.03/live lookup when not cached; confirm with user before bulk OpenSOS runs

## Tool cheat sheet
| Tool | Spends? | Purpose |
|------|---------|---------|
| health | No | Readiness |
| permits_contractors_summary | No | Shovels GC counts |
| permits_contractors_query | No | Paginated GCs |
| permits_contractors_sample | No | ≤20 random GCs |
| permits_contractors_get | No | One GC by id |
| permits_contractors_export_csv | No | Filtered GC CSV (cap 5000) |
| parcels_summary | No | Parcel inventory counts |
| parcels_query | No | Paginated parcels |
| parcels_sample | No | ≤20 random parcels |
| parcels_export_csv | No | Filtered parcel CSV (cap 5000) |
| opensos_lookup | ~$0.03 | Entity → officers (local_llc) |
| sync_to_supabase | No | Maps-style S2S sync; counts only |
`.trim();

export const GUIDE_MARKDOWN = `# Permit & Parcel MCP — operator guide

## Identity
- **Name:** Permit & Parcel MCP
- **Server:** \`permit-parcel\`
- **Jobs:** Shovels commercial GCs + DCAD/TAD/CCAD commercial parcels + OpenSOS for local LLCs
- **Removed:** Propwire / LoopNet / Google owner cascade (broken; not repaired)

## Triggers
- "Shovels contractors" / "6400 GC file" / DFW commercial GCs
- "DCAD / TAD / CCAD parcels" / commercial owners by county
- "Who are the officers of this LLC?" (local entities only)

## Anti-triggers
- Maps restaurant/HVAC scrapes
- Institutional REIT/fund owner outreach
- Propwire property pulls

## Sync rule
Always prefer \`sync_to_supabase\` + SQL \`select count(*)\` over dumping CSV/rows into the model context.
`;

export const WHEN_TO_USE_MARKDOWN = `# When to use Permit & Parcel MCP

## Yes
- Cached Shovels commercial contractor contacts (~6,124)
- Commercial parcels from Dallas / Tarrant / Collin appraisal districts
- OpenSOS officer lookup for **local LLC** owners

## No
- Propwire/LoopNet cascade (removed)
- Maps local businesses
- Institutional fund/REIT owners (drop them)
- Bulk row dumps through chat — use sync_to_supabase

## Money
Parcels + Shovels are free. OpenSOS ~$0.03/lookup — confirm before bulk.
`;
