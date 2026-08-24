import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../server/config.js';
import {
  clearAppSetting,
  enrichmentKeysStatus,
  setAppSetting,
} from '../server/lib/appSettings.js';
import {
  clearShovelsApiKey,
  getShovelsKeyStatus,
  setShovelsApiKey,
} from '../server/lib/shovelsKey.js';
import { hasSupabase, SCHEMA } from '../server/lib/supabase.js';
import { supabaseTargetMeta } from '../server/lib/supabaseTarget.js';
import {
  listCallingLists,
  queryCallingList,
  saveCallingList,
} from '../server/services/callingLists.js';
import {
  lookupLineTypes,
  matchTexasOfficers,
  ownerPeopleSearch,
  recordOwnerCell,
  scoreCallingList,
} from '../server/services/enrichCallingList.js';
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

const minPermitCount = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('Inclusive min Shovels permit_count. Optional — do not use this to drop small local GCs.');
const maxPermitCount = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('Inclusive max Shovels permit_count. Optional — do not use this to drop small local GCs.');
const excludeNationalChains = z
  .boolean()
  .optional()
  .describe(
    'true = drop national GCs / public homebuilders / franchise trades (name match or 5,000+ employees). Keeps local shops of any permit volume.',
  );

async function healthPayload() {
  const target = supabaseTargetMeta();
  const shovelsKey = await getShovelsKeyStatus();
  return {
    ok: true,
    product: 'Permit & Parcel MCP',
    demoMode: config.demoMode,
    supabaseConfigured: hasSupabase(),
    supabase_project: target.supabase_project,
    supabase_schema: target.supabase_schema ?? SCHEMA,
    supabase_url: target.supabase_url,
    shovels_api_configured: shovelsKey.configured,
    shovels_api_key: shovelsKey,
    shovels_contractors_loaded: loadShovelsContractors().length,
    parcels_loaded: loadParcels().length,
    when_to_use:
      'Shovels commercial GCs (including credit estimates); change the Shovels API key from Claude; DCAD/TAD/CCAD commercial parcels; mailing-address operator rollup; persist/filter cold-calling lists in Supabase (e.g. Cayden).',
    when_not_to_use:
      'Propwire/LoopNet cascade (removed), Maps scrapes, institutional REIT/fund owners, paid SOS unmasking, bulk row dumps in chat.',
    how_to_use:
      'Keys: set_enrichment_api_key for Veriphone + Texas CPA. Score → match_texas_officers → lookup_line_type → owner_people_search → query_calling_list(dial_status=owner_cell). Credits: shovels_estimate_credits. Never echo API keys.',
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
        'USE FOR: (1) Shovels commercial contractor contacts (~6,124 DFW GCs) including Shovels API credit estimates; (2) Cayden can set/change the Shovels API key from Claude; (3) persist those pulls to Supabase calling lists; (4) filter saved lists for cold calling; (5) DCAD/TAD/CCAD commercial parcels; (6) build_operators mailing-address rollup. DO NOT USE FOR: Propwire/LoopNet, Maps scrapes, paid SOS unmasking. Prefer save_calling_list / sync_to_supabase + select count(*). Never echo a full API key.',
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
    async () => jsonResult(await healthPayload()),
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
      description: `Search/filter cached Shovels GC contacts. Max 50/page. Free. Prefer exclude_national_chains=true. Do not drop low-permit locals.`,
      inputSchema: {
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
        min_permit_count: minPermitCount,
        max_permit_count: maxPermitCount,
        exclude_national_chains: excludeNationalChains,
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
      description: `≤20 random Shovels GC rows for QA. Free. Prefer exclude_national_chains=true.`,
      inputSchema: {
        n: z.number().int().min(1).max(20).optional(),
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
        min_permit_count: minPermitCount,
        max_permit_count: maxPermitCount,
        exclude_national_chains: excludeNationalChains,
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
          min_permit_count: args.min_permit_count,
          max_permit_count: args.max_permit_count,
          exclude_national_chains: args.exclude_national_chains,
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
      description: `CSV for matching Shovels GCs, cap 5000. Prefer sync_to_supabase for bulk. Supports permit-count range.`,
      inputSchema: {
        q: z.string().optional(),
        place: placeEnum,
        city: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
        min_permit_count: minPermitCount,
        max_permit_count: maxPermitCount,
        exclude_national_chains: excludeNationalChains,
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

  // ---- Shovels API key (Cayden can change from Claude) ----

  server.registerTool(
    'shovels_api_key_status',
    {
      title: 'Shovels API key — status (masked)',
      description: `WHEN TO USE: Cayden asks whether a Shovels key is set, or before changing it.
WHAT IT DOES: Returns configured/source/masked fingerprint only. Never the full key. Free.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(await getShovelsKeyStatus()),
  );

  server.registerTool(
    'shovels_set_api_key',
    {
      title: 'Shovels API key — set from Claude',
      description: `WHEN TO USE: Cayden wants to paste/change the Shovels API key from Claude (no Railway env edit).
WHAT IT DOES: Stores the key in memory and persists it to Supabase so Railway restarts keep it. Overwrites the env key at runtime.
RULES: confirm must be true. Never repeat the full key in chat — only the masked fingerprint. Default set_by=cayden.`,
      inputSchema: {
        api_key: z.string().min(1).describe('The Shovels API key. Do not echo this back in chat.'),
        confirm: z
          .boolean()
          .describe('Must be true. Show Cayden you are about to replace the live Shovels key, then set true.'),
        set_by: z.string().optional().describe('Who is changing it. Default cayden.'),
        persist: z
          .boolean()
          .optional()
          .describe('Save to Supabase so it survives restarts. Default true.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async (args) => {
      if (args.confirm !== true) {
        return errorResult(
          'Set confirm=true after Cayden agrees to replace the live Shovels API key. Do not echo the key.',
        );
      }
      try {
        return jsonResult(
          await setShovelsApiKey({
            api_key: args.api_key,
            set_by: args.set_by,
            persist: args.persist,
          }),
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'shovels_set_api_key failed');
      }
    },
  );

  server.registerTool(
    'shovels_clear_api_key',
    {
      title: 'Shovels API key — clear Claude override',
      description: `WHEN TO USE: Cayden wants to drop the Claude-set key and fall back to SHOVELS_API_KEY env (or unset).
RULES: confirm must be true. Never echo any key.`,
      inputSchema: {
        confirm: z.boolean().describe('Must be true'),
        set_by: z.string().optional().describe('Default cayden'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async (args) => {
      if (args.confirm !== true) {
        return errorResult('Set confirm=true to clear the Claude-set Shovels API key.');
      }
      try {
        return jsonResult(await clearShovelsApiKey({ set_by: args.set_by }));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'shovels_clear_api_key failed');
      }
    },
  );

  // ---- Shovels API credit estimate + calling lists ----

  server.registerTool(
    'shovels_estimate_credits',
    {
      title: 'Estimate Shovels API credits',
      description: `WHEN TO USE: User asks how many Shovels API credits a contractor pull would cost.
WHAT IT DOES: Probes Shovels include_count and returns TWO estimates: free_tier_pages (1 credit/page — last Dallas+Tarrant was ~65 / under 500) and paid_tier_companies (1 credit per contractor). Default geos = Dallas + Tarrant.
NEXT: Show both numbers. Ask if they are on free or paid. Cached save_calling_list still costs 0.`,
      inputSchema: {
        geos: z
          .string()
          .optional()
          .describe('Comma list: Dallas, Tarrant, Fort_Worth, Rockwall. Default Dallas+Tarrant'),
        place: placeEnum,
        city: z.string().optional(),
        date_from: z.string().optional().describe('YYYY-MM-DD, default last 12 months'),
        date_to: z.string().optional().describe('YYYY-MM-DD'),
        property_type: z.string().optional().describe("Default 'commercial'"),
        page_size: z.number().int().min(1).max(100).optional().describe('Default 100 (last DFW job)'),
        max_records: z.number().int().min(1).optional(),
        q: z.string().optional(),
        state: z.string().optional(),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => jsonResult(await estimateShovelsCredits(args)),
  );

  server.registerTool(
    'save_calling_list',
    {
      title: 'Save contractor pull to Supabase calling list',
      description: `WHEN TO USE: Persist a filtered Shovels GC pull so Cayden (or another caller) can filter it later via MCP.
WHAT IT DOES: Writes matching contractors to public.scrape_leads and catalogs the list in permit_parcel.calling_lists (owner + name). 0 Shovels credits (local file). Returns counts + list id only.
NEXT: Tell the user the list id and owner. They filter with list_calling_lists / query_calling_list.
QUALIFY: exclude_national_chains=true. Do not drop low-permit locals. Optional min/max only if they name a band.`,
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
        min_permit_count: minPermitCount,
        max_permit_count: maxPermitCount,
        exclude_national_chains: excludeNationalChains,
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
              min_permit_count: args.min_permit_count,
              max_permit_count: args.max_permit_count,
              exclude_national_chains: args.exclude_national_chains,
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
QUALIFY: exclude_national_chains=true. Do not drop low-permit locals.
RULE: Paginate. Summarize fill (phone/email). Do not dump the whole list into chat.`,
      inputSchema: {
        list_id: z.string().optional().describe('Calling list / scrape job id from save_calling_list'),
        owner: z.string().optional().describe('e.g. cayden — all of that owner\'s lists'),
        q: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        has_phone: z.boolean().optional().describe('true = dialable rows only'),
        has_email: z.boolean().optional(),
        dial_status: z
          .enum(['owner_cell', 'owner_landline', 'company_line', 'needs_enrichment', 'skip'])
          .optional()
          .describe('After enrichment. owner_cell = Cayden can dial'),
        min_permit_count: minPermitCount,
        max_permit_count: maxPermitCount,
        exclude_national_chains: excludeNationalChains,
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

  server.registerTool(
    'enrichment_keys_status',
    {
      title: 'Enrichment API keys — status (masked)',
      description: `WHEN TO USE: Before officer match or line-type lookup. Shows whether Veriphone + Texas Comptroller + Shovels keys are set. Never the full keys.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(await enrichmentKeysStatus()),
  );

  server.registerTool(
    'set_enrichment_api_key',
    {
      title: 'Set Veriphone or Texas Comptroller API key',
      description: `WHEN TO USE: Cayden pastes a Veriphone or Texas CPA API key from Claude.
RULES: confirm=true. Never echo the full key. key is veriphone_api_key or texas_cpa_api_key (or shovels_api_key).`,
      inputSchema: {
        key: z
          .enum(['veriphone_api_key', 'texas_cpa_api_key', 'shovels_api_key'])
          .describe('Which key to set'),
        api_key: z.string().min(1).describe('The secret. Do not echo this back.'),
        confirm: z.boolean().describe('Must be true'),
        set_by: z.string().optional(),
        persist: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async (args) => {
      if (args.confirm !== true) {
        return errorResult('Set confirm=true after Cayden agrees to save the key. Do not echo it.');
      }
      try {
        return jsonResult(
          await setAppSetting({
            key: args.key,
            api_key: args.api_key,
            set_by: args.set_by,
            persist: args.persist,
          }),
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'set_enrichment_api_key failed');
      }
    },
  );

  server.registerTool(
    'clear_enrichment_api_key',
    {
      title: 'Clear a Claude-set enrichment API key',
      description: 'Drops the Claude override for Veriphone / Texas CPA / Shovels. confirm=true.',
      inputSchema: {
        key: z.enum(['veriphone_api_key', 'texas_cpa_api_key', 'shovels_api_key']),
        confirm: z.boolean(),
        set_by: z.string().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async (args) => {
      if (args.confirm !== true) return errorResult('Set confirm=true to clear the key.');
      try {
        return jsonResult(await clearAppSetting({ key: args.key, set_by: args.set_by }));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'clear failed');
      }
    },
  );

  server.registerTool(
    'score_calling_list',
    {
      title: 'Score a calling list (free owner/office guess)',
      description: `WHEN TO USE: After save_calling_list, before any paid lookup.
WHAT IT DOES: Flags owner-likely vs company-line from email/name/shared phone. $0. Persists enrichment. Returns counts only.`,
      inputSchema: {
        list_id: z.string().min(1),
        limit: z.number().int().min(1).max(2000).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonResult(await scoreCallingList(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'score_calling_list failed');
      }
    },
  );

  server.registerTool(
    'match_texas_officers',
    {
      title: 'Match Texas Comptroller officers (free PIR)',
      description: `WHEN TO USE: Confirm the legal owner/manager name for companies on a calling list.
WHAT IT DOES: Official Comptroller franchise search — officer name, title, home address. Free, no key required. Default cap 200.`,
      inputSchema: {
        list_id: z.string().min(1),
        limit: z.number().int().min(1).max(500).optional(),
        only_unmatched: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await matchTexasOfficers(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'match_texas_officers failed');
      }
    },
  );

  server.registerTool(
    'lookup_line_type',
    {
      title: 'Veriphone line type (cell vs landline)',
      description: `WHEN TO USE: After scoring, to mark Shovels phones as mobile/landline/voip.
COST: ~$2.40 per 1,000 (Veriphone Standard). First call without confirm=true returns the $ estimate only.
RULES: Show the estimate. confirm=true to spend. Default cap 200. Never echo the API key.`,
      inputSchema: {
        list_id: z.string().min(1),
        confirm: z.boolean().optional().describe('Must be true to spend credits'),
        limit: z.number().int().min(1).max(1000).optional(),
        only_unknown: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await lookupLineTypes(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'lookup_line_type failed');
      }
    },
  );

  server.registerTool(
    'owner_people_search',
    {
      title: 'Google / free people-search URLs for leftover owners',
      description: `WHEN TO USE: Rows still needs_enrichment after officers + line type.
WHAT IT DOES: Builds Google + FastPeopleSearch + TruePeopleSearch URLs from the officer name + city/zip. Does not scrape. Then record_owner_cell.`,
      inputSchema: {
        list_id: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional().describe('Default 25 packs'),
        dial_status: z.string().optional().describe('Default needs_enrichment'),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await ownerPeopleSearch(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'owner_people_search failed');
      }
    },
  );

  server.registerTool(
    'record_owner_cell',
    {
      title: 'Save a confirmed owner cell from people search',
      description: `WHEN TO USE: After Cayden or Claude finds a wireless number on FastPeopleSearch/TruePeopleSearch that matches the officer address.
WHAT IT DOES: Sets owner_cell + dial_status=owner_cell. Do not save landlines or relatives.`,
      inputSchema: {
        list_id: z.string().min(1),
        lead_id: z.number().int(),
        phone: z.string().min(7),
        source: z.string().optional().describe('e.g. fastpeoplesearch'),
        line_type: z.enum(['mobile', 'landline', 'voip', 'unknown']).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonResult(await recordOwnerCell(args));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'record_owner_cell failed');
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
        min_permit_count: minPermitCount,
        max_permit_count: maxPermitCount,
        exclude_national_chains: excludeNationalChains,
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
            min_permit_count: args.min_permit_count,
            max_permit_count: args.max_permit_count,
            exclude_national_chains: args.exclude_national_chains,
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
1) If they want to change the Shovels key: shovels_set_api_key (confirm=true). Never echo the full key.
2) If they ask cost/credits: shovels_estimate_credits (show free pages AND paid companies)
3) permits_contractors_summary / query/sample as needed (paginate). Use exclude_national_chains=true. Do not drop low-permit locals.
4) save_calling_list with owner (e.g. cayden) and exclude_national_chains=true so the pull lands in Supabase
5) They filter later with list_calling_lists + query_calling_list (has_phone=true for dialing)
6) verify with select count(*) — never dump all rows into chat.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pp_set_shovels_key',
    {
      title: 'Set or change the Shovels API key',
      description: 'Use when Cayden wants to paste a new Shovels API key from Claude.',
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
            text: `Permit & Parcel MCP — Shovels API key.
Request: "${request || 'Cayden wants to set or change the Shovels API key'}"
1) shovels_api_key_status — show only the masked fingerprint
2) Ask Cayden to paste the new key in chat
3) shovels_set_api_key with confirm=true, set_by=cayden, persist=true
4) Never repeat the full key. Confirm the new masked fingerprint.
5) Optionally shovels_estimate_credits to verify the key works.`,
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
3) query_calling_list with has_phone=true and exclude_national_chains=true (paginate ≤50). Do not drop low-permit locals.
4) Never dump the full list into chat. Summarize counts and offer the next page.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pp_enrich_owner_cells',
    {
      title: 'Enrich a calling list to owner cells',
      description: 'Score, Comptroller officers, Veriphone line type, then people-search leftovers.',
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
            text: `Permit & Parcel MCP — owner-cell enrichment.
Request: "${request || 'Get Cayden owner cells on his latest list'}"
1) enrichment_keys_status — if Veriphone or Texas CPA missing, have Cayden paste via set_enrichment_api_key. Never echo keys.
2) list_calling_lists(owner=cayden) then score_calling_list
3) match_texas_officers
4) lookup_line_type without confirm (show $), then confirm=true
5) owner_people_search for needs_enrichment. Open people-search URLs. record_owner_cell for wireless + matching address only.
6) query_calling_list(dial_status=owner_cell). Do not dump the list.`,
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
3) Drop institutional. For local_llc, use build_operators + free Texas Comptroller PIR.
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
