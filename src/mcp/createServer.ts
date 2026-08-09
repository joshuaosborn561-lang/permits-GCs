import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../server/config.js';
import { hasSupabase } from '../server/lib/supabase.js';
import { getOpenSosUsage, openSosEstimate, openSosLookup } from '../server/services/openSos.js';
import {
  loadParcels,
  parcelsSummary,
  parcelsToCsv,
  queryParcels,
  sampleParcels,
} from '../server/services/parcels.js';
import {
  contractorsToCsv,
  getShovelsContractor,
  loadShovelsContractors,
  queryShovelsContractors,
  sampleShovelsContractors,
  shovelsContractorsSummary,
} from '../server/services/shovelsContractors.js';
import { syncToSupabase } from '../server/services/syncToSupabase.js';
import {
  GUIDE_MARKDOWN,
  SERVER_INSTRUCTIONS,
  WHEN_TO_USE_MARKDOWN,
} from './instructions.js';

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

const placeEnum = z
  .enum(['Dallas', 'Fort_Worth', 'Rockwall_County'])
  .optional()
  .describe('Shovels geography tag');

const countyEnum = z.enum(['Dallas', 'Tarrant', 'Collin']).optional();
const ownerTypeEnum = z
  .enum(['individual', 'local_llc', 'institutional', 'unknown'])
  .optional();

function healthPayload() {
  return {
    ok: true,
    product: 'Permit & Parcel MCP',
    demoMode: config.demoMode,
    supabaseConfigured: hasSupabase(),
    openSosConfigured: Boolean(config.openSosApiKey),
    openSosMonthlyLimit: config.openSosMonthlyLimit,
    shovels_contractors_loaded: loadShovelsContractors().length,
    parcels_loaded: loadParcels().length,
    when_to_use:
      'Shovels commercial GCs; DCAD/TAD/CCAD commercial parcels; OpenSOS for local LLC officers.',
    when_not_to_use:
      'Propwire/LoopNet cascade (removed), Maps scrapes, institutional REIT/fund outreach, bulk row dumps in chat.',
    how_to_use:
      'Contractors: permits_contractors_summary → query/sample → sync_to_supabase. Parcels: parcels_summary → parcels_query → sync_to_supabase → opensos_lookup for local_llc only. Verify with select count(*).',
    removed:
      'pmf_parse_query, pmf_confirm_run, Propwire → LoopNet → Google owner cascade (broken; not repaired).',
  };
}

export function createPmFinderMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'permit-parcel',
      version: '2.0.0',
      title: 'Permit & Parcel MCP',
      description:
        'USE FOR: (1) Shovels commercial contractor contacts (~6,124 DFW GCs); (2) DCAD/TAD/CCAD commercial parcels with owner_type classification; (3) OpenSOS officer lookup for local LLCs. DO NOT USE FOR: Propwire/LoopNet (removed), Maps scrapes, institutional fund owners. Prefer sync_to_supabase + select count(*) over dumping rows into chat.',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerResource(
    'pp_guide',
    'permit-parcel://guide',
    {
      title: 'Permit & Parcel operator guide',
      description: 'Full manual: Shovels GCs, parcels, OpenSOS, sync rules.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE_MARKDOWN }],
    }),
  );

  server.registerResource(
    'pp_when_to_use',
    'permit-parcel://when-to-use',
    {
      title: 'When to use Permit & Parcel (quick)',
      description: 'Yes/no decision + money/context gates.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: WHEN_TO_USE_MARKDOWN }],
    }),
  );

  server.registerTool(
    'health',
    {
      title: 'Health check',
      description:
        'Readiness: Supabase, OpenSOS key, loaded contractor + parcel counts. Call first.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(healthPayload()),
  );

  // ---- Shovels / permits contractors (behavior unchanged; prefix renamed) ----

  server.registerTool(
    'permits_contractors_summary',
    {
      title: 'Shovels commercial contractors — summary',
      description: `WHEN TO USE: Counts for the ~6,124 Shovels commercial GC file (Dallas / Fort Worth / Rockwall).
WHAT IT DOES: Summary counts + fill rates. Free. Local cache.
RULE: Never dump all rows into chat; use query/sample/sync.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(shovelsContractorsSummary()),
  );

  server.registerTool(
    'permits_contractors_query',
    {
      title: 'Shovels commercial contractors — paginated query',
      description: `Search/filter cached Shovels GC contacts. Max 50/page. Free.`,
      inputSchema: {
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => jsonResult(queryShovelsContractors(args)),
  );

  server.registerTool(
    'permits_contractors_sample',
    {
      title: 'Shovels commercial contractors — random sample',
      description: `≤20 random Shovels GC rows for QA. Free.`,
      inputSchema: {
        n: z.number().int().min(1).max(20).optional(),
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      jsonResult(
        sampleShovelsContractors(args.n ?? 20, {
          q: args.q,
          place: args.place,
          city: args.city,
          state: args.state,
          has_email: args.has_email,
          has_phone: args.has_phone,
          has_website: args.has_website,
        }),
      ),
  );

  server.registerTool(
    'permits_contractors_get',
    {
      title: 'Shovels commercial contractor — get by id',
      description: `One cached contractor by Shovels id. Free.`,
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const row = getShovelsContractor(id);
      if (!row) return errorResult(`Contractor not found: ${id}`);
      return jsonResult(row);
    },
  );

  server.registerTool(
    'permits_contractors_export_csv',
    {
      title: 'Shovels commercial contractors — filtered CSV',
      description: `CSV for matching Shovels GCs, cap 5000. Prefer sync_to_supabase for bulk.`,
      inputSchema: {
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const items = [];
      let page = 1;
      for (;;) {
        const batch = queryShovelsContractors({ ...args, page, page_size: 50 });
        items.push(...batch.items);
        if (page >= batch.total_pages || items.length >= 5000) break;
        page += 1;
      }
      const capped = items.slice(0, 5000);
      return jsonResult({
        total_matching: capped.length,
        capped_at: 5000,
        csv: contractorsToCsv(capped),
        hint: 'For bulk persistence use sync_to_supabase(dataset=contractors).',
      });
    },
  );

  // ---- Parcels ----

  server.registerTool(
    'parcels_summary',
    {
      title: 'Appraisal parcels — summary',
      description: `Counts for DCAD/TAD/CCAD commercial parcels by county and owner_type. Free.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(parcelsSummary()),
  );

  server.registerTool(
    'parcels_query',
    {
      title: 'Appraisal parcels — paginated query',
      description: `WHEN TO USE: Search commercial parcels (county, owner_name, city, zip, use_code, owner_type).
WHAT IT DOES: Returns one page (max 50) + totals. Free. Local CAD extracts.
NEXT: sync_to_supabase(dataset=parcels) for full matching set; opensos_lookup only for local_llc.`,
      inputSchema: {
        county: countyEnum,
        owner_name: z.string().optional(),
        city: z.string().optional(),
        zip: z.string().optional(),
        use_code: z.string().optional(),
        owner_type: ownerTypeEnum,
        min_assessed_value: z.number().optional(),
        q: z.string().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => jsonResult(queryParcels(args)),
  );

  server.registerTool(
    'parcels_sample',
    {
      title: 'Appraisal parcels — random sample',
      description: `≤20 random matching parcels for QA. Free.`,
      inputSchema: {
        n: z.number().int().min(1).max(20).optional(),
        county: countyEnum,
        owner_name: z.string().optional(),
        city: z.string().optional(),
        zip: z.string().optional(),
        use_code: z.string().optional(),
        owner_type: ownerTypeEnum,
        q: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => jsonResult(sampleParcels(args.n ?? 20, args)),
  );

  server.registerTool(
    'parcels_export_csv',
    {
      title: 'Appraisal parcels — filtered CSV',
      description: `CSV for matching parcels, cap 5000. Prefer sync_to_supabase for bulk persistence.`,
      inputSchema: {
        county: countyEnum,
        owner_name: z.string().optional(),
        city: z.string().optional(),
        zip: z.string().optional(),
        use_code: z.string().optional(),
        owner_type: ownerTypeEnum,
        min_assessed_value: z.number().optional(),
        q: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const items = [];
      let page = 1;
      for (;;) {
        const batch = queryParcels({ ...args, page, page_size: 50 });
        items.push(...batch.items);
        if (page >= batch.total_pages || items.length >= 5000) break;
        page += 1;
      }
      const capped = items.slice(0, 5000);
      return jsonResult({
        total_matching: capped.length,
        capped_at: 5000,
        csv: parcelsToCsv(capped),
        hint: 'For bulk persistence use sync_to_supabase(dataset=parcels).',
      });
    },
  );

  // ---- OpenSOS (estimate → human approval → confirm_spend) ----

  server.registerTool(
    'opensos_usage',
    {
      title: 'OpenSOS monthly usage (quota)',
      description: `WHEN TO USE: Check how many OpenSOS live lookups remain this month (limit 1000).
WHAT IT DOES: Returns used/remaining/limit for the current UTC month. Free. No API spend.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(await getOpenSosUsage()),
  );

  server.registerTool(
    'opensos_estimate',
    {
      title: 'OpenSOS estimate (required before spend)',
      description: `WHEN TO USE: Before ANY live OpenSOS lookup. Pass one or many entity names.
WHAT IT DOES: Classifies cache vs live vs skip; returns estimated_live_requests, estimated_cost_usd, monthly remaining. Does NOT call OpenSOS API.
NEXT: Show the estimate to the human. Wait for explicit approval ("approve opensos" / "confirm"). Only then opensos_lookup(..., confirm_spend=true).
HARD RULE: Never run live OpenSOS without showing this estimate and getting approval.`,
      inputSchema: {
        entity_names: z
          .array(z.string().min(1))
          .min(1)
          .max(200)
          .describe('Entity names to estimate'),
        state: z.string().optional().describe("Default 'TX'"),
        force: z.boolean().optional().describe('Treat cache as miss'),
        allow_non_llc: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => jsonResult(await openSosEstimate(args)),
  );

  server.registerTool(
    'opensos_lookup',
    {
      title: 'OpenSOS entity → officers (local LLC, spend-gated)',
      description: `WHEN TO USE: After opensos_estimate + explicit human approval for live calls.
WHAT IT DOES: Cache hit = free (no confirm needed). Live call requires confirm_spend=true, counts against 1000/month, ~$0.03, writes to Supabase.
WHEN NOT TO USE: institutional (drop) or individual (owner is DM). Never batch-live without estimate + approval.
HARD RULE: If confirm_spend is not true, live lookups are blocked.`,
      inputSchema: {
        entity_name: z.string().min(1),
        state: z.string().optional().describe("Default 'TX'"),
        force: z.boolean().optional().describe('Bypass Supabase cache'),
        allow_non_llc: z
          .boolean()
          .optional()
          .describe('Override local_llc gate (use sparingly)'),
        confirm_spend: z
          .boolean()
          .optional()
          .describe(
            'Must be true for live OpenSOS HTTP calls, and only after opensos_estimate + explicit user approval',
          ),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await openSosLookup(args)),
  );

  // ---- Sync ----

  server.registerTool(
    'sync_to_supabase',
    {
      title: 'sync_to_supabase — Maps-style S2S sync (counts only)',
      description: `WHEN TO USE: Persist parcels and/or Shovels contractors to Supabase without loading rows into chat.
WHAT IT DOES: Server-to-server upsert into permit_parcel.parcels (when parcels) + public.scrape_jobs/leads/exports. Returns COUNTS + verify_sql only.
NEXT: Run verify_sql select count(*).`,
      inputSchema: {
        dataset: z
          .enum(['parcels', 'contractors', 'all'])
          .describe('Which dataset(s) to sync'),
        county: countyEnum.describe('Optional parcel county filter'),
        owner_type: ownerTypeEnum.describe('Optional parcel owner_type filter'),
        place: placeEnum.describe('Optional Shovels place filter'),
        q: z.string().optional().describe('Optional text filter for the chosen dataset'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await syncToSupabase({
          dataset: args.dataset,
          parcel_query: {
            county: args.county,
            owner_type: args.owner_type,
            q: args.dataset === 'contractors' ? undefined : args.q,
          },
          contractor_query: {
            place: args.place,
            q: args.dataset === 'parcels' ? undefined : args.q,
          },
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'sync failed');
      }
    },
  );

  server.registerPrompt(
    'pp_query_contractors',
    {
      title: 'Query Shovels commercial contractors',
      description: 'Use for the ~6124 DFW commercial GC file.',
      argsSchema: {
        request: z.string().optional(),
      },
    },
    async ({ request }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Permit & Parcel MCP — Shovels contractors.
Request: "${request || 'Summarize the contractor file'}"
1) permits_contractors_summary
2) query/sample as needed (paginate)
3) sync_to_supabase(dataset=contractors) for bulk persistence
4) verify with select count(*) — never dump all rows into chat.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pp_query_parcels',
    {
      title: 'Query appraisal parcels + optional OpenSOS',
      description: 'DCAD/TAD/CCAD commercial parcels; OpenSOS for local_llc only.',
      argsSchema: {
        request: z.string().optional(),
      },
    },
    async ({ request }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Permit & Parcel MCP — appraisal parcels.
Request: "${request || 'Summarize commercial parcels'}"
1) parcels_summary
2) parcels_query with filters; note owner_type split
3) Drop institutional. For local_llc: opensos_estimate → show live request count + $ + monthly remaining → WAIT for explicit approval → opensos_lookup(confirm_spend=true). Cap 1000/month.
4) sync_to_supabase(dataset=parcels) then select count(*)
Propwire cascade is removed — do not offer it.`,
          },
        },
      ],
    }),
  );

  return server;
}

/** @deprecated alias */
export const createPermitParcelMcpServer = createPmFinderMcpServer;
