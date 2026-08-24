#!/usr/bin/env node
/**
 * Stdio MCP entrypoint for Claude Desktop / Cursor local MCP.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadPersistedShovelsKey } from '../server/lib/shovelsKey.js';
import { createPermitParcelMcpServer } from './createServer.js';

async function main() {
  await loadPersistedShovelsKey();
  const server = createPermitParcelMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[permit-parcel-mcp] fatal', err);
  process.exit(1);
});
