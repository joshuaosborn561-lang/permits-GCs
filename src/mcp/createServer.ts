import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../server/config.js';
import { hasSupabase, SCHEMA } from '../server/lib/supabase.js';
import { supabaseTargetMeta } from '../server/lib/supabaseTarget.js';
import {
  listCallingLists,
  queryCallingList,
  saveCallingList,
} from '../server/services/callingLists.js';
import { buildOperators } from '../server/services/operators.js';
import {
  loadParcels,
  parcelsSummary,
  parcelsToCsv,
  queryParcels,
  sampleParcels,
} from '../server/services/parcels.js';
import { estimateShovelsCredits } from '../server/services/shovelsCredits.js';
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
  .enum(['individual', 'local_llc', 'institutional', 'municipal', 'unknown'])
  .optional();

function healthPayload() {
  const target = supabaseTargetMeta();
  return {
    ok: true,
    product: 'Permit & Parcel MCP',
    demoMode: config.demoMode,
    supabaseConfigured: hasSupabase(),
    supabase_project: target.supabase_project,
    supabase_schema: target.supabase_schema ?? SCHEMA,
    supabase_url: target.supabase_url,
    shovels_contractors_loaded: loadShovelsContractors().length,
    parcels_loaded: loadParcels().length,
    when_to_use:
      'Shovels commercial GCs (including credit estimates); DCAD/TAD/CCAD commercial parcels; mailing-address operator rollup; persist/filter cold-calling lists in Supabase (e.g. Cayden).',
    when_not_to_use:
      'Propwire/LoopNet cascade (removed), Maps scrapes, institutional REIT/fund owners, OpenSOS/SOSDirect (removed, legacy), bulk row dumps in chat.',
    how_to_use:
      'Shovels credits: shovels_estimate_credits (cached=0; live API=1 credit/record). Contractors: summary → estimate → query/sample → save_calling_list / sync_to_supabase. Cayden: list_calling_lists → query_calling_list (has_phone/city). Parcels: parcels_summary → parcels_query → sync_to_supabase → build_operators. Verify with select count(*).',
    removed:
      'pmf_parse_query, pmf_confirm_run, Propwire → LoopNet → Google owner cascade (broken; not repaired).',
  };
}

export function createPermitParcelMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'permits-gcs',
      version: '2.0.0',
      title: 'Permit & Parcel MCP (permits-GCs)',
      description:
        'USE FOR: (1) Shovels commercial contractor contacts (~6,124 DFW GCs) including Shovels API credit estimates; (2) persist those pulls to Supabase calling lists; (3) filter saved lists for cold calling (Cayden etc.); (4) DCAD/TAD/CCAD commercial parcels; (5) build_operators mailing-address rollup. DO NOT USE FOR: Propwire/LoopNet, Maps scrapes, OpenSOS (removed). Prefer save_calling_list / sync_to_supabase + select count(*).',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerResource(
    'pp_guide',
    'permit-parcel://guide',
    {
      title: 'Permit & Parcel operator guide',
      description: 'Full manual: Shovels GCs, credit estimates, calling lists, parcels, sync rules.',
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
        'Readiness: Supabase, loaded contractor + parcel counts. Call first.',
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
NEXT: sync_to_supabase(dataset=parcels) for full matching set.`,
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

  // ---- Shovels API credit estimate + calling lists ----

  server.registerTool(
    'shovels_estimate_credits',
    {
      title: 'Estimate Shovels API credits',
      description: `WHEN TO USE: User asks how many Shovels API credits a contractor pull would cost (Claude / "estimate credits" / "what would this cost on Shovels").
WHAT IT DOES: Counts matching rows in the local DFW snapshot and returns two numbers: cached_query=0 credits, live_shovels_api=1 credit per record (paid Shovels rule). Does NOT call Shovels. Free.
NEXT: Show both numbers. If they want the list, save_calling_list (writes Supabase, still 0 Shovels credits) then Cayden can query_calling_list.`,
      inputSchema: {
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
        max_records: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Cap the live-API credit estimate (1 credit per record)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => jsonResult(estimateShovelsCredits(args)),
  );

  server.registerTool(
    'save_calling_list',
    {
      title: 'Save contractor pull to Supabase calling list',
      description: `WHEN TO USE: Persist a filtered Shovels GC pull so Cayden (or another caller) can filter it later via MCP.
WHAT IT DOES: Writes matching contractors to public.scrape_leads and catalogs the list in permit_parcel.calling_lists (owner + name). 0 Shovels credits (local file). Returns counts + list id only.
NEXT: Tell the user the list id and owner. They filter with list_calling_lists / query_calling_list.`,
      inputSchema: {
        name: z.string().optional().describe('Human list name, e.g. "Cayden Fort Worth GCs with phone"'),
        owner: z
          .string()
          .optional()
          .describe('Who the list is for, e.g. "cayden". Used as the filter key later.'),
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonResult(
          await saveCallingList({
            name: args.name,
            owner: args.owner,
            contractor_query: {
              q: args.q,
              place: args.place,
              city: args.city,
              state: args.state,
              has_email: args.has_email,
              has_phone: args.has_phone,
              has_website: args.has_website,
            },
          }),
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'save_calling_list failed');
      }
    },
  );

  server.registerTool(
    'list_calling_lists',
    {
      title: 'List saved cold-calling lists',
      description: `WHEN TO USE: Cayden (or anyone) asks what calling lists exist, or needs a list_id.
WHAT IT DOES: Reads permit_parcel.calling_lists from Supabase. Filter by owner (e.g. cayden). Counts only + metadata. Free.`,
      inputSchema: {
        owner: z.string().optional().describe('e.g. cayden'),
        q: z.string().optional().describe('Search list name / owner / id'),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonResult(await listCallingLists(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'list_calling_lists failed');
      }
    },
  );

  server.registerTool(
    'query_calling_list',
    {
      title: 'Filter a saved calling list (cold calling)',
      description: `WHEN TO USE: Cayden wants dialable contacts from a saved list (has phone, city, name search).
WHAT IT DOES: Pages rows from the Supabase-backed list (max 50/page). Free. Does not re-pull Shovels.
RULE: Paginate. Summarize fill (phone/email). Do not dump the whole list into chat.`,
      inputSchema: {
        list_id: z.string().optional().describe('Calling list / scrape job id from save_calling_list'),
        owner: z.string().optional().describe('e.g. cayden — all of that owner\'s lists'),
        q: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        has_phone: z.boolean().optional().describe('true = dialable rows only'),
        has_email: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonResult(await queryCallingList(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'query_calling_list failed');
      }
    },
  );

  // ---- Operators (mailing-address rollup) ----

  server.registerTool(
    'build_operators',
    {
      title: 'build_operators — mailing-address operator rollup',
      description: `WHEN TO USE: Collapse shell LLCs into real operators by normalised tax-bill mailing address.
WHAT IT DOES: Groups local CAD parcels by mailing address (strips C/O/ATTN/%); excludes out-of-state, municipal, and tax-department addresses; writes permit_parcel.operators; returns COUNTS only.
DEFAULTS: min_parcels=2, min_llcs=1, exclude_out_of_state/municipal/tax_departments=true, home_states=TX.
PRIME FILTER: min_llcs=3, min_portfolio_value=5000000.
Do not buy paid SOS unmasking for every LLC — resolve operators first; prefer free Texas Comptroller PIR later.`,
      inputSchema: {
        min_parcels: z.number().int().min(1).optional(),
        min_llcs: z.number().int().min(1).optional(),
        min_portfolio_value: z.number().int().min(0).optional(),
        exclude_out_of_state: z.boolean().optional(),
        exclude_municipal: z.boolean().optional(),
        exclude_tax_departments: z.boolean().optional(),
        home_states: z
          .string()
          .optional()
          .describe('Comma-separated home state codes, default TX'),
        target_schema: z.string().optional(),
        target_table: z.string().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonResult(await buildOperators(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'build_operators failed');
      }
    },
  );

  // ---- Sync ----

  server.registerTool(
    'sync_to_supabase',
    {
      title: 'sync_to_supabase — Maps-style S2S sync (counts only)',
      description: `WHEN TO USE: Persist parcels and/or Shovels contractors to Supabase without loading rows into chat.
WHAT IT DOES: Full matching set (no silent 50k cap). Upserts permit_parcel.parcels on (county, account_id). Honours county. Fails if scrape rows insert but schema upsert is 0. Returns COUNTS + supabase_project + verify_sql only.
NEXT: Run verify_sql select count(*). Confirm supabase_project matches the project you inspect.`,
      inputSchema: {
        dataset: z
          .enum(['parcels', 'contractors', 'all'])
          .describe('Which dataset(s) to sync'),
        county: countyEnum.describe('Optional parcel county filter'),
        owner_type: ownerTypeEnum.describe('Optional parcel owner_type filter'),
        place: placeEnum.describe('Optional Shovels place filter'),
        q: z.string().optional().describe('Optional text filter for the chosen dataset'),
        list_name: z
          .string()
          .optional()
          .describe('When syncing contractors, name the calling list (Cayden will see this)'),
        owner: z
          .string()
          .optional()
          .describe('When syncing contractors, who owns the calling list (e.g. cayden)'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await syncToSupabase({
          dataset: args.dataset,
          list_name: args.list_name,
          owner: args.owner,
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
1) If they ask cost/credits: shovels_estimate_credits (cached=0; live Shovels API=1 credit/record)
2) permits_contractors_summary / query/sample as needed (paginate)
3) save_calling_list with owner (e.g. cayden) so the pull lands in Supabase
4) They filter later with list_calling_lists + query_calling_list (has_phone=true for dialing)
5) verify with select count(*) — never dump all rows into chat.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pp_filter_calling_list',
    {
      title: 'Filter a saved cold-calling list',
      description: 'Use when Cayden (or another caller) wants to pull/filter a saved Shovels list.',
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
            text: `Permit & Parcel MCP — saved calling lists.
Request: "${request || 'Show Cayden calling lists with phone numbers'}"
1) If they asked Shovels credit cost first, call shovels_estimate_credits
2) list_calling_lists (owner=cayden if named)
3) query_calling_list with has_phone=true (paginate ≤50)
4) Never dump the full list into chat. Summarize counts and offer the next page.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pp_query_parcels',
    {
      title: 'Query appraisal parcels',
      description: 'DCAD/TAD/CCAD commercial parcels + operator rollup.',
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
3) Drop institutional. For local_llc, do not offer OpenSOS (removed). Use build_operators + free Texas Comptroller PIR.
4) sync_to_supabase(dataset=parcels) then select count(*)
Propwire cascade is removed — do not offer it.`,
          },
        },
      ],
    }),
  );

  return server;
}

/** @deprecated alias — old Property PM Finder name */
export const createPmFinderMcpServer = createPermitParcelMcpServer;
