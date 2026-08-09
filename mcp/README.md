# Permit & Parcel MCP

Repo: https://github.com/joshuaosborn561-lang/permits-GCs  
Remote MCP: `https://workspace-production-4702.up.railway.app/mcp` (authless Streamable HTTP).

## Tools

- `health`
- `permits_contractors_summary|query|sample|get|export_csv`
- `parcels_summary|query|sample|export_csv`
- `opensos_lookup`
- `sync_to_supabase`

## Context rule

Sync writes server-to-server. Verify with `select count(*)`. Do not dump bulk rows into chat.

Propwire cascade tools were removed.
