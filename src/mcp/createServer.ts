import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../server/config.js';
import { estimateCost } from '../server/lib/costs.js';
import { hasSupabase } from '../server/lib/supabase.js';
import { haversineMiles } from '../server/lib/zips.js';
import {
  createRun,
  getRun,
  listRuns,
  publicRunView,
  updateRun,
} from '../server/pipeline/jobStore.js';
import { startPipeline } from '../server/pipeline/runner.js';
import { planMarket } from '../server/services/planMarket.js';
import {
  contractorsToCsv,
  getShovelsContractor,
  loadShovelsContractors,
  queryShovelsContractors,
  sampleShovelsContractors,
  shovelsContractorsSummary,
} from '../server/services/shovelsContractors.js';
import type { ContactExportRow, ParsedQueryParams } from '../server/types.js';
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

function healthPayload() {
  return {
    ok: true,
    demoMode: config.demoMode,
    openaiModel: config.openaiModel,
    openaiBaseUrl: config.openaiBaseUrl || null,
    loopnetMode: config.loopnetMode,
    loopnetBatchSize: config.loopnetBatchSize,
    loopnetIncludeDetails: config.loopnetIncludeDetails,
    supabaseConfigured: hasSupabase(),
    openaiConfigured: Boolean(config.openaiApiKey),
    apifyConfigured: Boolean(config.apifyToken),
    getleadsConfigured: Boolean(config.getleadsApiKey),
    aiArkConfigured: Boolean(config.aiArkApiKey),
    leadmagicConfigured: Boolean(config.leadmagicApiKey),
    product:
      'SalesGlider commercial property owner → PM company → decision-maker contacts for outbound.',
    when_to_use:
      'Commercial property owners/landlords/PMs/decision-maker contacts in a US city, county, or radius; status/CSV of an existing PM-finder run; or querying the cached Shovels commercial contractor contact dataset (Dallas / Fort Worth / Rockwall).',
    when_not_to_use:
      'Google Maps local-business scrapes, residential-only lists, Smartlead/CRM sends, LLC→person resolution.',
    how_to_use:
      'Read pmf://guide (or pmf://when-to-use). Property pipeline: health → parse → resolve ambiguity → show estimate → confirm_spend → poll → results/CSV. Shovels contractors (cached, free): pmf_shovels_contractors_summary → query/sample (paginated; never dump all rows into chat).',
    shovels_contractors_loaded: loadShovelsContractors().length,
  };
}

function buildExportRows(runId: string): ContactExportRow[] {
  const job = getRun(runId);
  if (!job) return [];
  if (job.contacts.length) {
    return job.contacts.map((c) => {
      const p = job.properties.find((x) => x.id === c.property_id);
      return {
        contact_name: c.contact_name,
        contact_title: c.contact_title,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
        contact_source: c.source,
        match_confidence: c.match_confidence,
        property_manager_company: c.property_manager_company,
        pm_confidence: p?.pm_confidence ?? null,
        pm_source: p?.pm_source ?? null,
        owner_entity_name: p?.owner_entity_name ?? null,
        owner_type: p?.owner_type ?? null,
        care_of_company: p?.care_of_company ?? null,
        address: p?.address ?? null,
        city: p?.city ?? null,
        state: p?.state ?? null,
        zip: p?.zip ?? null,
        latitude: p?.latitude ?? null,
        longitude: p?.longitude ?? null,
      };
    });
  }
  return job.properties.map((p) => ({
    contact_name: null,
    contact_title: null,
    contact_email: null,
    contact_phone: null,
    contact_source: null,
    match_confidence: null,
    property_manager_company: p.property_manager_company,
    pm_confidence: p.pm_confidence,
    pm_source: p.pm_source,
    owner_entity_name: p.owner_entity_name,
    owner_type: p.owner_type,
    care_of_company: p.care_of_company,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    latitude: p.latitude,
    longitude: p.longitude,
  }));
}

function filterExportRows(
  rows: ContactExportRow[],
  opts: { center?: string; radius_miles?: number },
): ContactExportRow[] {
  if (!opts.center || !opts.radius_miles) return rows;
  const coord = opts.center.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!coord) return rows;
  const lat = Number(coord[1]);
  const lng = Number(coord[2]);
  return rows.filter((r) => {
    if (r.latitude == null || r.longitude == null) return false;
    return haversineMiles(lat, lng, r.latitude, r.longitude) <= opts.radius_miles!;
  });
}

function toCsv(rows: ContactExportRow[]): string {
  const headers: (keyof ContactExportRow)[] = [
    'contact_name',
    'contact_title',
    'contact_email',
    'contact_phone',
    'contact_source',
    'match_confidence',
    'property_manager_company',
    'pm_confidence',
    'pm_source',
    'owner_entity_name',
    'owner_type',
    'care_of_company',
    'address',
    'city',
    'state',
    'zip',
    'latitude',
    'longitude',
  ];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join(
    '\n',
  );
}

/** Fresh MCP server instance with all Property PM Finder tools. */
export function createPmFinderMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'property-pm-finder',
      version: '1.1.0',
      title: 'SalesGlider Property PM Finder',
      description:
        'USE FOR: commercial property owners, property managers, and PM decision-maker contacts in a US market (city/county/radius), plus status/CSV of those runs. DO NOT USE FOR: Google Maps local businesses, residential-only lists, Smartlead sends, or LLC→person resolution. SPEND RULE: parse/estimate are free; only pmf_confirm_run spends money and requires explicit user approval after you show the estimate. Workflow: health → parse → resolve ambiguity → show estimate → confirm_spend → poll → results/CSV. Read resources pmf://guide and pmf://when-to-use.',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerResource(
    'pmf_guide',
    'pmf://guide',
    {
      title: 'Property PM Finder operator guide',
      description:
        'Read this first (or when unsure). Full manual: what the MCP does, trigger phrases, anti-triggers, spend-safe workflow, cascade, and how to interpret results.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: GUIDE_MARKDOWN,
        },
      ],
    }),
  );

  server.registerResource(
    'pmf_when_to_use',
    'pmf://when-to-use',
    {
      title: 'When to use this MCP (quick)',
      description:
        'Short yes/no decision: when to use Property PM Finder vs other tools, plus the money gate.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: WHEN_TO_USE_MARKDOWN,
        },
      ],
    }),
  );

  server.registerTool(
    'pmf_health',
    {
      title: 'Health check',
      description: `WHEN TO USE: At the start of any PM-finder request, or if a run fails mysteriously.
WHAT IT DOES: Reports demo/live mode and whether OpenAI, Apify, Supabase, getleads, AI Ark, LeadMagic are configured.
WHEN NOT TO USE: Not a substitute for parsing or running a pull.
NEXT: If ready, call pmf_parse_query. If demoMode=true, warn the user that results will be synthetic.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(healthPayload()),
  );

  server.registerTool(
    'pmf_parse_query',
    {
      title: 'Parse natural language query',
      description: `WHEN TO USE: User asks for commercial property owners / PMs / landlords in a US market (city, county, miles-from-city, or explicit ZIP list).
WHAT IT DOES: Parses free text into location params + cost estimate and creates a run in awaiting_confirmation. Resolves radius briefs to a ZIP footprint (does not widen to whole neighboring states). Does NOT spend money.
OVERRIDES: optional zips (comma-separated, wins outright), center + radius_miles, exclude_categories.
WHEN NOT TO USE: Maps restaurant/local business leads → wrong product.
IMPORTANT: If response.ambiguous=true, ask the user to pick from ambiguity_options, then pmf_resolve_location.
NEXT: Show estimate (include zip_count when present). Wait for explicit approval before pmf_confirm_run.`,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Natural language market request, e.g. "commercial properties within 150 miles of Dallas, TX" or "commercial property owners in Fort Worth, TX — 100 records"',
          ),
        zips: z
          .string()
          .optional()
          .describe(
            'Optional comma-separated 5-digit ZIPs. When set, wins over center/radius/city. Supports 1000+ ZIPs.',
          ),
        center: z
          .string()
          .optional()
          .describe('Optional center override, e.g. "Dallas, TX" or "32.7767,-97.0000"'),
        radius_miles: z
          .number()
          .positive()
          .optional()
          .describe('Optional radius in miles around center (or around the brief center)'),
        exclude_categories: z
          .string()
          .optional()
          .describe(
            'Comma-separated niches to exclude, e.g. "roofing contractor". Also extracted from "do not include …" in the brief.',
          ),
        max_records: z.number().int().min(1).max(50000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, zips, center, radius_miles, exclude_categories, max_records }) => {
      try {
        const planned = await planMarket({
          query,
          zips,
          center,
          radius_miles,
          exclude_categories,
          max_records,
        });
        const run = createRun({
          query,
          params: planned.parsed,
          estimate: planned.estimate,
        });
        return jsonResult({
          run: publicRunView(run),
          parsed: planned.parsed,
          estimate: planned.estimate,
          zip_count: planned.zip_count,
          states: planned.states,
          center: planned.center,
          radius_miles: planned.radius_miles,
          geo_mode: planned.mode,
          needs_confirmation: true,
          ambiguous: Boolean(planned.parsed.ambiguous),
          assistant_instructions: planned.parsed.ambiguous
            ? 'Ask the user which ambiguity_options location to use, then call pmf_resolve_location. Do NOT call pmf_confirm_run yet.'
            : 'Present estimate.total_low–estimate.total_high, zip_count/center/radius when set, and key assumptions. Ask the user to confirm spending. Prefer max_records 25–100 for first pulls. Only then call pmf_confirm_run with confirm_spend=true.',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'parse failed');
      }
    },
  );

  server.registerTool(
    'pmf_resolve_location',
    {
      title: 'Resolve ambiguous location',
      description: `WHEN TO USE: pmf_parse_query returned ambiguous=true (e.g. "Springfield" without a state).
WHAT IT DOES: Locks the run to a concrete location_value and refreshes the cost estimate. Still does not spend money.
WHEN NOT TO USE: Location already includes a clear state/county and ambiguous=false.
NEXT: Show the refreshed estimate and wait for user approval before pmf_confirm_run.`,
      inputSchema: {
        run_id: z.string().uuid().describe('Run id from pmf_parse_query'),
        location_value: z
          .string()
          .min(1)
          .describe('User-chosen disambiguated location, e.g. "Fort Worth, TX" or "Fulton County, GA"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id, location_value }) => {
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      try {
        const planned = await planMarket({
          params: {
            ...run.parsed_params,
            location_value,
            center:
              run.parsed_params.location_type === 'radius' || run.parsed_params.center
                ? location_value
                : run.parsed_params.center,
            ambiguous: false,
            ambiguity_options: [],
            ambiguity_reason: null,
          },
        });
        const updated = updateRun(run.id, {
          parsed_params: planned.parsed,
          total_cost_estimate: planned.estimate.total_high,
          cost_estimate_detail: planned.estimate,
          status: 'awaiting_confirmation',
        });
        return jsonResult({
          run: publicRunView(updated),
          parsed: planned.parsed,
          estimate: planned.estimate,
          zip_count: planned.zip_count,
          states: planned.states,
          center: planned.center,
          radius_miles: planned.radius_miles,
          assistant_instructions:
            'Present the estimate and wait for explicit user approval before pmf_confirm_run(confirm_spend=true).',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'resolve failed');
      }
    },
  );

  server.registerTool(
    'pmf_confirm_run',
    {
      title: 'Confirm and start pipeline',
      description: `WHEN TO USE: Only after (1) parse/resolve is done, (2) you showed the cost estimate, and (3) the user explicitly approved spending (e.g. "confirm", "run it", "go ahead").
WHAT IT DOES: Starts the paid pipeline: Propwire → c/o parse → LoopNet → Google (cap 5000) → contact enrichment waterfall. Writes results to Supabase / scrape_leads.
SPENDS MONEY: Yes. Requires confirm_spend=true.
WHEN NOT TO USE: User is still deciding, only asked for an estimate, or location is still ambiguous.
RECOMMENDED: Pass max_records=100 (or 25) for first pulls unless user demanded a full market.`,
      inputSchema: {
        run_id: z.string().uuid().describe('Run id awaiting confirmation'),
        confirm_spend: z
          .literal(true)
          .describe(
            'Must be the boolean true, and only after the human explicitly approved the estimate/spend.',
          ),
        max_records: z
          .number()
          .int()
          .min(1)
          .max(50000)
          .optional()
          .describe('Override record cap. Use 25–100 for samples; omit only if user wants the parsed default.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, confirm_spend, max_records }) => {
      if (confirm_spend !== true) {
        return errorResult(
          'confirm_spend must be true after explicit user approval. Do not start the pipeline yet.',
        );
      }
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      if (run.parsed_params.ambiguous) {
        return errorResult('Resolve location ambiguity with pmf_resolve_location before confirming');
      }
      if (run.status === 'running' || run.status === 'completed') {
        return jsonResult({ run: publicRunView(run), note: 'Run already started or completed' });
      }
      if (max_records != null) {
        const params = { ...run.parsed_params, max_records };
        const estimate = estimateCost(params);
        updateRun(run.id, {
          parsed_params: params,
          total_cost_estimate: estimate.total_high,
          cost_estimate_detail: estimate,
        });
      }
      updateRun(run.id, { current_step: 'queued' });
      void startPipeline(run.id);
      return jsonResult({
        run: publicRunView(getRun(run.id)!),
        assistant_instructions:
          'Poll pmf_get_run until status is completed or failed. Then call pmf_get_results and offer pmf_export_csv. Do not invent contacts.',
      });
    },
  );

  server.registerTool(
    'pmf_get_run',
    {
      title: 'Get run status',
      description: `WHEN TO USE: After pmf_confirm_run, or when the user asks for status/cost of a run.
WHAT IT DOES: Returns status, current_step, cascade progress counters, and total_cost_actual.
WHEN NOT TO USE: Before a run exists — parse first.
TIP: Poll every few seconds while status=running.`,
      inputSchema: {
        run_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id }) => {
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      return jsonResult({ run: publicRunView(run) });
    },
  );

  server.registerTool(
    'pmf_list_runs',
    {
      title: 'List runs',
      description: `WHEN TO USE: User asks what pulls have been run, or you need to find a run_id.
WHAT IT DOES: Lists recent runs with status and cost summary (newest first).
WHEN NOT TO USE: For fetching contacts — use pmf_get_results on a specific run.`,
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Max runs to return (default 20)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      const runs = listRuns()
        .slice(0, limit ?? 20)
        .map(publicRunView);
      return jsonResult({ runs, count: runs.length });
    },
  );

  server.registerTool(
    'pmf_get_results',
    {
      title: 'Get contact-level results',
      description: `WHEN TO USE: Run status is completed (or user wants a preview of whatever is available).
WHAT IT DOES: Returns outreach-ready contact rows (one row per decision maker) joined with owner/PM/property fields. Optional filters.
WHEN NOT TO USE: To start a pull — use parse/confirm. Do not fabricate rows if empty.
HOW TO PRESENT: Summarize counts by pm_confidence and contact_source; highlight getleads=$0; mention unresolved PMs.`,
      inputSchema: {
        run_id: z.string().uuid(),
        q: z.string().optional().describe('Search name, email, company, address'),
        pm_confidence: z
          .enum(['high', 'medium', 'low', 'unresolved'])
          .optional()
          .describe('Filter by PM confidence'),
        contact_source: z
          .enum(['getleads', 'ai_ark', 'leadmagic', 'google_search', 'cache'])
          .optional()
          .describe('Filter by contact enrichment source'),
        limit: z.number().int().min(1).max(5000).optional().describe('Max rows (default 200)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id, q, pm_confidence, contact_source, limit }) => {
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      let rows = buildExportRows(run_id);
      const query = (q ?? '').toLowerCase();
      if (query) {
        rows = rows.filter((r) =>
          [r.contact_name, r.contact_email, r.property_manager_company, r.owner_entity_name, r.address, r.city]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(query)),
        );
      }
      if (pm_confidence) rows = rows.filter((r) => r.pm_confidence === pm_confidence);
      if (contact_source) rows = rows.filter((r) => r.contact_source === contact_source);
      const capped = rows.slice(0, limit ?? 200);
      return jsonResult({
        run: publicRunView(run),
        total_matching: rows.length,
        returned: capped.length,
        rows: capped,
      });
    },
  );

  server.registerTool(
    'pmf_export_csv',
    {
      title: 'Export results CSV',
      description: `WHEN TO USE: User wants a downloadable/importable contact file for Smartlead, Sheets, etc.
WHAT IT DOES: Returns full contact-level CSV text including latitude/longitude. Optional center+radius_miles filters rows post-hoc without re-scraping.
WHEN NOT TO USE: For a quick chat summary — use pmf_get_results instead.`,
      inputSchema: {
        run_id: z.string().uuid(),
        center: z
          .string()
          .optional()
          .describe('Optional "lat,lng" center for post-hoc radius filter'),
        radius_miles: z
          .number()
          .positive()
          .optional()
          .describe('Optional miles from center; rows without coordinates are dropped when set'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id, center, radius_miles }) => {
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      const rows = filterExportRows(buildExportRows(run_id), { center, radius_miles });
      const csv = toCsv(rows);
      return {
        content: [
          {
            type: 'text' as const,
            text: csv,
          },
        ],
      };
    },
  );

  server.registerTool(
    'pmf_estimate_cost',
    {
      title: 'Estimate cost from structured params',
      description: `WHEN TO USE: User asks "what would 500 records in Dallas cost?" with structured fields, or wants a ZIP/radius what-if without creating a run.
WHAT IT DOES: Resolves geography (zips > center+radius > city/county) and returns cost estimate. No spend.
WHEN NOT TO USE: User gave free text and wants to actually pull — use pmf_parse_query instead.`,
      inputSchema: {
        location_type: z.enum(['city', 'radius', 'county', 'zips']).optional(),
        location_value: z.string().optional(),
        radius_miles: z.number().nullable().optional(),
        max_records: z.number().int().min(1).max(50000).optional(),
        zips: z
          .string()
          .optional()
          .describe('Comma-separated 5-digit ZIPs; wins over center/radius/city'),
        center: z.string().optional().describe('"Dallas, TX" or "32.7767,-97.0000"'),
        exclude_categories: z.string().optional(),
        brief: z.string().optional().describe('Optional NL brief instead of structured fields'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({
      location_type,
      location_value,
      radius_miles,
      max_records,
      zips,
      center,
      exclude_categories,
      brief,
    }) => {
      try {
        const planned = await planMarket({
          query: brief,
          location_type,
          location_value,
          radius_miles: radius_miles ?? undefined,
          max_records,
          zips,
          center,
          exclude_categories,
        });
        return jsonResult({
          params: planned.parsed,
          estimate: planned.estimate,
          zip_count: planned.zip_count,
          states: planned.states,
          center: planned.center,
          radius_miles: planned.radius_miles,
          geo_mode: planned.mode,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'estimate failed');
      }
    },
  );

  server.registerPrompt(
    'pmf_run_commercial_pull',
    {
      title: 'Run a commercial PM finder pull',
      description:
        'PRIMARY PROMPT: use whenever the user wants commercial property owners / PMs / decision-maker contacts for a US market. Enforces estimate → human approval → paid run → results.',
      argsSchema: {
        request: z
          .string()
          .describe(
            'User request, e.g. "commercial property owners in Fort Worth, TX, 100 records"',
          ),
      },
    },
    async ({ request }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are operating the SalesGlider Property PM Finder MCP (commercial owners → PMs → decision-maker contacts).

User request:
"${request}"

Follow this exact workflow:
1. Read pmf://when-to-use (and pmf://guide if needed). Confirm this is commercial property PM outreach — not Maps businesses or Smartlead send.
2. Call pmf_health. If demoMode=true or critical keys are missing, warn before continuing.
3. Call pmf_parse_query with the request (free; creates run awaiting_confirmation).
4. If ambiguous=true, ask which ambiguity_options location to use, then pmf_resolve_location. Never guess silently.
5. Show cost estimate clearly ($low–$high, location, record cap, short assumptions). Ask for explicit approval to spend. Recommend max_records=100 for a first pull.
6. Do NOT call pmf_confirm_run until the user clearly approves ("confirm", "run it", "go ahead"). Vague interest is not approval.
7. After confirm_spend=true, poll pmf_get_run until completed/failed. Explain cascade steps if asked (Propwire → c/o → LoopNet → Google → enrichment).
8. Call pmf_get_results. Summarize: records pulled, PM by confidence/source, contacts by contact_source (note getleads=$0). Offer pmf_export_csv.
9. Never invent contacts or PMs. Estimates are free; confirms spend money.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pmf_check_run_status',
    {
      title: 'Check PM finder run status',
      description:
        'Use when the user asks for status, progress, or cost of an existing Property PM Finder run.',
      argsSchema: {
        run_id: z.string().optional().describe('Known run UUID; omit to list recent runs first'),
      },
    },
    async ({ run_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: run_id
              ? `Check Property PM Finder run ${run_id}: call pmf_get_run. If running, report current_step and progress; if completed, summarize via pmf_get_results and offer CSV; if failed, report the error clearly. Do not start a new paid run.`
              : `User wants status of Property PM Finder runs. Call pmf_list_runs, help them identify the right run_id, then pmf_get_run. Do not start a new paid run unless they explicitly ask and approve a new estimate.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'pmf_export_contacts',
    {
      title: 'Export PM finder contacts',
      description:
        'Use when the user wants CSV or contact rows from a completed (or existing) Property PM Finder run.',
      argsSchema: {
        run_id: z.string().describe('Run UUID to export'),
      },
    },
    async ({ run_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Export Property PM Finder contacts for run ${run_id}. Call pmf_get_run first. If completed (or has rows), call pmf_get_results for a short summary, then pmf_export_csv and provide the CSV. Do not invent rows. Do not start a new paid run.`,
          },
        },
      ],
    }),
  );

  const placeEnum = z
    .enum(['Dallas', 'Fort_Worth', 'Rockwall_County'])
    .optional()
    .describe('Filter to a pull geography tag on the cached dataset');

  server.registerTool(
    'pmf_shovels_contractors_summary',
    {
      title: 'Shovels commercial contractors — summary',
      description: `WHEN TO USE: User asks about the cached Shovels commercial contractor list (Dallas / Fort Worth / Rockwall County), counts, or contact fill rates.
WHAT IT DOES: Returns summary counts only (unique contractors, by place, phone/email fill). Free. Does NOT call Shovels API.
WHEN NOT TO USE: For browsing actual company rows — use pmf_shovels_contractors_query or pmf_shovels_contractors_sample.
RULE: Never dump the full ~6k list into chat; summarize from this tool.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(shovelsContractorsSummary()),
  );

  server.registerTool(
    'pmf_shovels_contractors_query',
    {
      title: 'Shovels commercial contractors — paginated query',
      description: `WHEN TO USE: Search/filter the cached Shovels commercial contractor contacts (name, company, place, has email/phone).
WHAT IT DOES: Returns one page of matching rows (default 25, max 50) plus total/page metadata. Free. Local dataset only.
WHEN NOT TO USE: For counts only → summary tool. For a random QA peek → sample tool.
RULE: Paginate. Do not loop pages to reconstruct the full dump in the model context.`,
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe('Search name, business, email, phone, city, or place tag'),
        place: placeEnum,
        city: z.string().optional().describe('Address city filter, e.g. "FORT WORTH"'),
        state: z.string().optional().describe('Address state, e.g. "TX"'),
        has_email: z.boolean().optional(),
        has_phone: z.boolean().optional(),
        has_website: z.boolean().optional(),
        page: z.number().int().min(1).optional().describe('1-based page (default 1)'),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Rows per page (default 25, max 50)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      jsonResult(
        queryShovelsContractors({
          q: args.q,
          place: args.place,
          city: args.city,
          state: args.state,
          has_email: args.has_email,
          has_phone: args.has_phone,
          has_website: args.has_website,
          page: args.page,
          page_size: args.page_size,
        }),
      ),
  );

  server.registerTool(
    'pmf_shovels_contractors_sample',
    {
      title: 'Shovels commercial contractors — random sample',
      description: `WHEN TO USE: Spot-check data quality of the cached Shovels contractor contacts.
WHAT IT DOES: Returns up to 20 random matching rows. Free.
WHEN NOT TO USE: For exhaustive search — use the paginated query tool.`,
      inputSchema: {
        n: z.number().int().min(1).max(20).optional().describe('Sample size (default 20, max 20)'),
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
    'pmf_shovels_contractors_get',
    {
      title: 'Shovels commercial contractor — get by id',
      description: `WHEN TO USE: Look up one cached contractor by Shovels id.
WHAT IT DOES: Returns a single row or not-found. Free.`,
      inputSchema: {
        id: z.string().min(1).describe('Shovels contractor id'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const row = getShovelsContractor(id);
      if (!row) return errorResult(`Contractor not found: ${id}`);
      return jsonResult(row);
    },
  );

  server.registerTool(
    'pmf_shovels_contractors_export_csv',
    {
      title: 'Shovels commercial contractors — filtered CSV',
      description: `WHEN TO USE: User wants a CSV file of the cached Shovels commercial contractors (optionally filtered).
WHAT IT DOES: Returns CSV text for matching rows, capped at 5000. Free. Local dataset only.
RULE: Prefer filters (place/has_email/q). Do not paste the entire CSV into chat — give a short summary and offer the CSV payload for download/save.`,
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
      const pageSize = 50;
      let page = 1;
      const items = [];
      for (;;) {
        const batch = queryShovelsContractors({
          q: args.q,
          place: args.place,
          city: args.city,
          state: args.state,
          has_email: args.has_email,
          has_phone: args.has_phone,
          has_website: args.has_website,
          page,
          page_size: pageSize,
        });
        items.push(...batch.items);
        if (page >= batch.total_pages || items.length >= 5000) break;
        page += 1;
      }
      const capped = items.slice(0, 5000);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                total_matching: capped.length,
                capped_at: 5000,
                csv: contractorsToCsv(capped),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}
