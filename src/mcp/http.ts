import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { supabaseTargetMeta } from '../server/lib/supabaseTarget.js';
import { createPermitParcelMcpServer } from './createServer.js';

/**
 * Mount Streamable HTTP MCP at /mcp for Claude / Cursor remote connectors.
 * Stateful sessions (mcp-session-id) + GET SSE.
 */
export function mountMcpHttp(app: Express): void {
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const cleanupTransport = async (sessionId: string) => {
    const transport = transports[sessionId];
    if (!transport) return;
    delete transports[sessionId];
    try {
      await transport.close();
    } catch (err) {
      console.warn('[mcp http] transport close failed', sessionId, err);
    }
  };

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionIdHeader)
        ? sessionIdHeader[0]
        : sessionIdHeader;

      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            console.log('[mcp http] session initialized', id);
            transports[id] = transport!;
          },
        });

        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id && transports[id]) {
            delete transports[id];
            console.log('[mcp http] session closed', id);
          }
        };

        const server = createPermitParcelMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad Request: No valid session ID provided. Send initialize without mcp-session-id first.',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp http] POST failed', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).json({
        error: 'Invalid or missing mcp-session-id for SSE stream',
      });
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (err) {
      console.error('[mcp http] GET SSE failed', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP SSE stream failed' });
      }
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    if (!sessionId || !transports[sessionId]) {
      res.status(404).json({ error: 'Unknown session' });
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (err) {
      console.error('[mcp http] DELETE failed', err);
    } finally {
      await cleanupTransport(sessionId);
    }
  });

  app.get('/mcp/health', (_req, res) => {
    const target = supabaseTargetMeta();
    res.json({
      ok: true,
      product: 'Permit & Parcel MCP',
      transport: 'streamable-http',
      path: '/mcp',
      authRequired: false,
      sessionMode: 'stateful',
      supportsGetSse: true,
      enableJsonResponse: true,
      activeSessions: Object.keys(transports).length,
      supabase_project: target.supabase_project,
      supabase_schema: target.supabase_schema,
      tools: [
        'health',
        'permits_contractors_summary',
        'permits_contractors_query',
        'permits_contractors_sample',
        'permits_contractors_get',
        'permits_contractors_export_csv',
        'shovels_estimate_credits',
        'save_calling_list',
        'list_calling_lists',
        'query_calling_list',
        'parcels_summary',
        'parcels_query',
        'parcels_sample',
        'parcels_export_csv',
        'build_operators',
        'sync_to_supabase',
      ],
      prompts: ['pp_query_contractors', 'pp_filter_calling_list', 'pp_query_parcels'],
      resources: ['permit-parcel://guide', 'permit-parcel://when-to-use'],
      http: {
        parcels_summary: '/api/parcels/summary',
        parcels_query: '/api/parcels',
        parcels_sync: 'POST /api/parcels/sync-to-supabase',
        contractors: '/api/shovels/contractors',
        shovels_estimate_credits: 'GET /api/shovels/contractors/estimate-credits',
        calling_lists: '/api/calling-lists',
        calling_lists_query: 'GET /api/calling-lists/query',
        build_operators: 'POST /api/build-operators',
        sync_to_supabase: 'POST /api/sync-to-supabase',
      },
      note: 'Authless MCP. Propwire cascade removed. Prefer sync_to_supabase + select count(*). Check supabase_project on /api/health.',
    });
  });
}
