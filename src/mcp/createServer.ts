import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../server/config.js';
import { estimateCost } from '../server/lib/costs.js';
import { hasSupabase } from '../server/lib/supabase.js';
import {
  createRun,
  getRun,
  listRuns,
  publicRunView,
  updateRun,
} from '../server/pipeline/jobStore.js';
import { startPipeline } from '../server/pipeline/runner.js';
import { parseNaturalLanguageQuery } from '../server/services/parseQuery.js';
import type { ContactExportRow, ParsedQueryParams } from '../server/types.js';

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
    supabaseConfigured: hasSupabase(),
    openaiConfigured: Boolean(config.openaiApiKey),
    apifyConfigured: Boolean(config.apifyToken),
    getleadsConfigured: Boolean(config.getleadsApiKey),
    aiArkConfigured: Boolean(config.aiArkApiKey),
    leadmagicConfigured: Boolean(config.leadmagicApiKey),
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
  }));
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
  ];
  const esc = (v: string | null | undefined) => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join(
    '\n',
  );
}

/** Fresh MCP server instance with all Property PM Finder tools. */
export function createPmFinderMcpServer(): McpServer {
  const server = new McpServer({
    name: 'property-pm-finder',
    version: '1.0.0',
  });

  server.registerTool(
    'pmf_health',
    {
      title: 'Health check',
      description:
        'Check Property PM Finder readiness: demo/live mode and which API integrations are configured (OpenAI, Apify, Supabase, getleads, AI Ark, LeadMagic).',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(healthPayload()),
  );

  server.registerTool(
    'pmf_parse_query',
    {
      title: 'Parse natural language query',
      description:
        'Parse a free-text commercial property pull request into structured params and a cost estimate. Does NOT start the pipeline or spend money. If ambiguous=true, call pmf_resolve_location before confirming.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Natural language request, e.g. "Get me all commercial property owners in Fort Worth, TX"',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        const parsed = await parseNaturalLanguageQuery(query);
        const estimate = estimateCost(parsed);
        const run = createRun({ query, params: parsed, estimate });
        return jsonResult({
          run: publicRunView(run),
          parsed,
          estimate,
          needs_confirmation: true,
          ambiguous: Boolean(parsed.ambiguous),
          next_step: parsed.ambiguous
            ? 'Call pmf_resolve_location with one of ambiguity_options, then pmf_confirm_run.'
            : 'Show the cost estimate to the user. Only call pmf_confirm_run after explicit user approval.',
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
      description:
        'Resolve a previously parsed run when the location was ambiguous (e.g. pick "Fort Worth, TX"). Refreshes the cost estimate. Does not start the pipeline.',
      inputSchema: {
        run_id: z.string().uuid().describe('Run id from pmf_parse_query'),
        location_value: z
          .string()
          .min(1)
          .describe('Disambiguated location, e.g. "Fort Worth, TX"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id, location_value }) => {
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      const params: ParsedQueryParams = {
        ...run.parsed_params,
        location_value,
        ambiguous: false,
        ambiguity_options: [],
        ambiguity_reason: null,
      };
      const estimate = estimateCost(params);
      const updated = updateRun(run.id, {
        parsed_params: params,
        total_cost_estimate: estimate.total_high,
        cost_estimate_detail: estimate,
        status: 'awaiting_confirmation',
      });
      return jsonResult({
        run: publicRunView(updated),
        parsed: params,
        estimate,
        next_step:
          'Show the cost estimate. Call pmf_confirm_run only after explicit user approval to spend.',
      });
    },
  );

  server.registerTool(
    'pmf_confirm_run',
    {
      title: 'Confirm and start pipeline',
      description:
        'WRITE / SPENDS MONEY. Starts the Propwire → c/o → LoopNet → Google → contact enrichment pipeline for a previously parsed run. Requires confirm_spend=true and prior explicit user approval after showing the cost estimate. Optionally override max_records for a small sample (recommended 25–100 first).',
      inputSchema: {
        run_id: z.string().uuid().describe('Run id awaiting confirmation'),
        confirm_spend: z
          .boolean()
          .describe('Must be true. Confirms the user approved spending money on this run.'),
        max_records: z
          .number()
          .int()
          .min(1)
          .max(50000)
          .optional()
          .describe('Optional override; use 25–100 for a test sample'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, confirm_spend, max_records }) => {
      if (!confirm_spend) {
        return errorResult(
          'confirm_spend must be true. Show the cost estimate and get explicit user approval first.',
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
        next_step: 'Poll pmf_get_run until status is completed or failed, then pmf_get_results.',
      });
    },
  );

  server.registerTool(
    'pmf_get_run',
    {
      title: 'Get run status',
      description:
        'Get live status, current step, progress counters (resolved at each cascade step), and running cost for a run.',
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
      description: 'List recent Property PM Finder runs with status and cost summary.',
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
      description:
        'Return contact-level result rows for a run (one row per decision maker, with property/owner/PM fields joined). Supports optional search and filters.',
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
      description:
        'Export contact-level results as CSV text for a run (ready for Smartlead / spreadsheet import).',
      inputSchema: {
        run_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id }) => {
      const run = getRun(run_id);
      if (!run) return errorResult('run not found');
      const csv = toCsv(buildExportRows(run_id));
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
      description:
        'Estimate pipeline cost from structured location params without creating a run. Useful for what-if sizing (e.g. 100 vs 5000 records).',
      inputSchema: {
        location_type: z.enum(['city', 'radius', 'county']),
        location_value: z.string().min(1),
        radius_miles: z.number().nullable().optional(),
        max_records: z.number().int().min(1).max(50000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ location_type, location_value, radius_miles, max_records }) => {
      const params: ParsedQueryParams = {
        location_type,
        location_value,
        radius_miles: location_type === 'radius' ? radius_miles ?? 50 : null,
        property_type: 'commercial',
        max_records: max_records ?? 5000,
        ambiguous: false,
        ambiguity_options: [],
        ambiguity_reason: null,
      };
      return jsonResult({ params, estimate: estimateCost(params) });
    },
  );

  server.registerPrompt(
    'pmf_run_commercial_pull',
    {
      title: 'Run a commercial PM finder pull',
      description:
        'Guided workflow: parse a market request, resolve ambiguity, show cost, get user approval, run pipeline, return contacts.',
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
            text: `Run a SalesGlider Property PM Finder pull for this request:

"${request}"

Workflow:
1. Call pmf_health. Warn if DEMO_MODE or missing keys.
2. Call pmf_parse_query with the request.
3. If ambiguous, ask the user which location option to use, then pmf_resolve_location.
4. Show the cost estimate clearly. Do NOT call pmf_confirm_run until the user explicitly approves spending.
5. Prefer a small max_records (25–100) unless they insist on a full pull.
6. After confirm, poll pmf_get_run until completed/failed.
7. Return pmf_get_results summary and offer pmf_export_csv.

Never invent contacts. Contacts synced to Supabase scrape_leads when the run completes.`,
          },
        },
      ],
    }),
  );

  return server;
}
