# Property PM Finder MCP Server

Gives Claude (Desktop, Cursor, or any MCP client) full access to SalesGlider’s commercial property owner → property manager → decision-maker pipeline.

On connect, Claude receives:

1. **`instructions`** (initialize) — full operating manual: what / when / when-not / spend rules / workflow
2. **Resources** — `pmf://guide` (full) and `pmf://when-to-use` (quick decision)
3. **Tool descriptions** — each tool has WHEN TO USE / WHAT IT DOES / WHEN NOT TO USE
4. **Prompts** — `pmf_run_commercial_pull`, `pmf_check_run_status`, `pmf_export_contacts`

## What it does

Turns requests like “commercial property owners in Fort Worth, TX” into outreach-ready contacts:

1. Pull commercial properties (Propwire)
2. Find the property management company (c/o → LoopNet → Google)
3. Find the decision maker at that PM firm (getleads → AI Ark → LeadMagic → Google)
4. Export contact-level CSV / sync into Supabase `scrape_leads`

## When Claude should use it

- Commercial property owners / landlords in a US city, county, or radius
- Property managers for those buildings
- Decision-maker contacts for outbound
- Status / CSV export of an existing PM-finder run

## When Claude should not use it

- Google Maps local-business scrapes
- Sending Smartlead / CRM campaigns from this MCP
- LLC → individual legal-name resolution
- Unrelated research

## Spend-safe workflow (enforced in instructions)

1. `pmf_health`
2. `pmf_parse_query` (free)
3. `pmf_resolve_location` if ambiguous
4. Show estimate → **wait for explicit user approval**
5. `pmf_confirm_run` with `confirm_spend=true` (spends money)
6. Poll `pmf_get_run`
7. `pmf_get_results` / `pmf_export_csv`

## Tools

| Tool | Spends $? | Purpose |
|------|-----------|---------|
| `pmf_health` | No | Readiness + when/how summary |
| `pmf_parse_query` | No | NL → params + estimate |
| `pmf_resolve_location` | No | Fix ambiguous location |
| `pmf_estimate_cost` | No | What-if cost |
| `pmf_confirm_run` | **Yes** | Start pipeline |
| `pmf_get_run` | No | Live status |
| `pmf_list_runs` | No | Recent runs |
| `pmf_get_results` | No | Contact rows |
| `pmf_export_csv` | No | CSV text |

## Claude Desktop (stdio)

1. `npm run build`
2. Copy [`claude_desktop_config.example.json`](./claude_desktop_config.example.json) into Claude Desktop MCP config
3. Point `args` at absolute `dist/mcp/stdio.js`
4. Fill env vars
5. Restart Claude Desktop

After connect, Claude should already see the operating manual via initialize `instructions`. You can also ask it to “read pmf://guide”.

## Remote HTTP (Railway)

- MCP endpoint: `https://workspace-production-4702.up.railway.app/mcp` (no auth)
- Health: `https://workspace-production-4702.up.railway.app/mcp/health`

**Claude.ai custom connector:** use that `/mcp` URL (Streamable HTTP). The server is **stateful**:

1. `POST /mcp` `initialize` → response includes `mcp-session-id`
2. Optional `GET /mcp` with `mcp-session-id` for the SSE notification stream
3. Further `POST /mcp` calls must include `mcp-session-id`

If Claude fails to connect, check `/mcp/health` for `"sessionMode":"stateful"` and `"supportsGetSse":true`. Older builds returned HTTP 405 on GET and broke Claude connectors.
