# Permit & Parcel MCP (`permits-GCs`)

Repo: https://github.com/joshuaosborn561-lang/permits-GCs

Use for Shovels commercial GCs, DCAD/TAD/CCAD commercial parcels, and OpenSOS on local LLCs.

Do not use Propwire/LoopNet (removed). Prefer `sync_to_supabase` + count(*) over row dumps.
Drop institutional owners. Call OpenSOS only for `local_llc`.
