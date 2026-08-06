import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createPmFinderMcpServer } from './createServer.js';

/** Mount Streamable HTTP MCP at /mcp for remote Claude / Cursor connectors. No auth. */
export function mountMcpHttp(app: Express): void {
  // Stateless streamable HTTP: one server+transport per request
  app.all('/mcp', async (req: Request, res: Response) => {
    if (req.method === 'GET' || req.method === 'DELETE') {
      // Stateless mode has no long-lived SSE sessions
      res.status(405).set('Allow', 'POST').json({
        error: 'Method not allowed. Use POST for streamable HTTP MCP in this deployment.',
      });
      return;
    }

    const server = createPmFinderMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp http]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  });

  app.get('/mcp/health', (_req, res) => {
    res.json({
      ok: true,
      transport: 'streamable-http',
      path: '/mcp',
      authRequired: false,
      tools: [
        'pmf_health',
        'pmf_parse_query',
        'pmf_resolve_location',
        'pmf_confirm_run',
        'pmf_get_run',
        'pmf_list_runs',
        'pmf_get_results',
        'pmf_export_csv',
        'pmf_estimate_cost',
      ],
      prompts: ['pmf_run_commercial_pull'],
      resources: ['pmf://guide'],
      note: 'Server sends detailed instructions on initialize. Read pmf://guide for the full operator guide.',
    });
  });
}
