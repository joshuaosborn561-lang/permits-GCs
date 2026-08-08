import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createPmFinderMcpServer } from './createServer.js';

/**
 * Mount Streamable HTTP MCP at /mcp for Claude / Cursor remote connectors.
 *
 * Stateful sessions (mcp-session-id) + GET SSE, matching the MCP SDK example
 * that Claude custom connectors expect. Stateless POST-only + 405 on GET
 * causes Claude.ai connectors to fail to connect.
 */
export function mountMcpHttp(app: Express): void {
  /** sessionId → transport (one MCP server connected per transport) */
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
          // JSON responses are more compatible with some Claude connector paths;
          // SSE is still available via GET for notifications.
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

        const server = createPmFinderMcpServer();
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

  // Claude opens GET /mcp (with mcp-session-id) for the optional SSE notification stream.
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
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('[mcp http] GET SSE failed', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP SSE stream failed' });
      }
    }
  });

  // Client may DELETE to end a session
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
    res.json({
      ok: true,
      transport: 'streamable-http',
      path: '/mcp',
      authRequired: false,
      sessionMode: 'stateful',
      supportsGetSse: true,
      enableJsonResponse: true,
      activeSessions: Object.keys(transports).length,
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
        'pmf_shovels_contractors_summary',
        'pmf_shovels_contractors_query',
        'pmf_shovels_contractors_sample',
        'pmf_shovels_contractors_get',
        'pmf_shovels_contractors_export_csv',
      ],
      prompts: [
        'pmf_run_commercial_pull',
        'pmf_check_run_status',
        'pmf_export_contacts',
        'pmf_query_shovels_contractors',
      ],
      resources: ['pmf://guide', 'pmf://when-to-use', 'pmf://shovels-contractors'],
      http: {
        shovels_contractors_summary: '/api/shovels/contractors/summary',
        shovels_contractors_query: '/api/shovels/contractors',
        shovels_contractors_sample: '/api/shovels/contractors/sample',
        shovels_contractors_export: '/api/shovels/contractors/export.csv',
      },
      note: 'Use POST /mcp for JSON-RPC (initialize returns mcp-session-id). Claude may GET /mcp with that header for SSE. No auth.',
    });
  });
}
