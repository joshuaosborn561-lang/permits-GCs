# Property PM Finder MCP Server

Gives Claude (Desktop, Claude.ai custom connector, or Cursor) full access to the commercial property owner / PM finder pipeline.

## Tools

| Tool | Type | Purpose |
|------|------|---------|
| `pmf_health` | read | Integration readiness |
| `pmf_parse_query` | read | NL → structured params + cost estimate (no spend) |
| `pmf_resolve_location` | read | Disambiguate city/county |
| `pmf_confirm_run` | **write** | Start pipeline (`confirm_spend=true` required) |
| `pmf_get_run` | read | Live status / cost / cascade counters |
| `pmf_list_runs` | read | Recent runs |
| `pmf_get_results` | read | Contact-level rows + filters |
| `pmf_export_csv` | read | CSV export text |
| `pmf_estimate_cost` | read | What-if cost from structured params |

Prompt: `pmf_run_commercial_pull` — guided end-to-end workflow.

## Claude Desktop (stdio)

1. `npm run build`
2. Copy [`claude_desktop_config.example.json`](./claude_desktop_config.example.json) into your Claude Desktop MCP config
3. Point `args` at the absolute path to `dist/mcp/stdio.js`
4. Fill env vars (same as Railway)
5. Restart Claude Desktop

Or locally without building: `npm run mcp` (tsx).

## Remote Claude / Cursor (Streamable HTTP)

The Railway app exposes:

- `POST https://<your-railway-domain>/mcp` — MCP streamable HTTP (no auth)
- `GET  https://<your-railway-domain>/mcp/health` — tool list

## Safety

`pmf_confirm_run` spends Apify/OpenAI money. The tool requires `confirm_spend=true`. Claude should show the estimate from `pmf_parse_query` and wait for your explicit approval before calling it.
