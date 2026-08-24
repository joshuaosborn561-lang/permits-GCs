#!/usr/bin/env node
/**
 * Stdio MCP entrypoint for Claude Desktop / Cursor local MCP.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAppSettings } from '../server/lib/appSettings.js';
import { createPermitParcelMcpServer } from './createServer.js';

async function main() {
  await loadAppSettings();
  const server = createPermitParcelMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[permit-parcel-mcp] fatal', err);
  process.exit(1);
});
