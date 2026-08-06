#!/usr/bin/env node
/**
 * Stdio MCP entrypoint for Claude Desktop / Cursor local MCP.
 *
 * Claude Desktop config example:
 * {
 *   "mcpServers": {
 *     "property-pm-finder": {
 *       "command": "node",
 *       "args": ["/absolute/path/to/dist/mcp/stdio.js"],
 *       "env": { ...same keys as Railway... }
 *     }
 *   }
 * }
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPmFinderMcpServer } from './createServer.js';

async function main() {
  const server = createPmFinderMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[pmf-mcp] fatal', err);
  process.exit(1);
});
