# Permit & Parcel MCP

Repo: https://github.com/joshuaosborn561-lang/permits-GCs  
Remote MCP: `https://workspace-production-4702.up.railway.app/mcp` (authless Streamable HTTP).

## Tools

- `health`
- `shovels_api_key_status` / `shovels_set_api_key` / `shovels_clear_api_key` — Cayden changes the Shovels key from Claude (never echo the full key)
- `shovels_estimate_credits` — live `include_count`; quote free pages **and** paid companies
- `permits_contractors_summary|query|sample|get|export_csv`
- `save_calling_list` / `list_calling_lists` / `query_calling_list` — persist + filter for Cayden
- `parcels_summary|query|sample|export_csv`
- `build_operators`
- `sync_to_supabase`

## Context rule

Sync writes server-to-server. Verify with `select count(*)`. Do not dump bulk rows into chat.

Propwire cascade tools were removed.
