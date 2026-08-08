import { config } from '../config.js';
import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import type { OpenSosOfficer, OpenSosResult } from '../types.js';
import { classifyOwnerType } from './ownerType.js';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function officersFrom(data: Record<string, unknown>): OpenSosOfficer[] {
  const out: OpenSosOfficer[] = [];
  const raw = data.officers ?? data.Officers ?? data.principals;
  if (Array.isArray(raw)) {
    for (const o of raw) {
      if (!o || typeof o !== 'object') continue;
      const row = o as Record<string, unknown>;
      const name = str(row.name) || str(row.full_name) || str(row.officerName);
      if (!name) continue;
      out.push({
        name,
        title: str(row.title) || str(row.role) || str(row.officerTitle),
      });
    }
  }
  return out;
}

function managingMembersFrom(data: Record<string, unknown>, officers: OpenSosOfficer[]): string[] {
  const raw = data.managingMembers ?? data.managing_members ?? data.members;
  if (Array.isArray(raw)) {
    return raw
      .map((m) => (typeof m === 'string' ? m : str((m as Record<string, unknown>).name)))
      .filter((x): x is string => Boolean(x));
  }
  return officers
    .filter((o) => /manag|member|principal/i.test(o.title || ''))
    .map((o) => o.name);
}

async function cacheLookup(result: OpenSosResult): Promise<void> {
  if (!hasSupabase()) return;
  const { error } = await getSupabase().rpc('ingest_permit_parcel_opensos', {
    p_secret: ingestSecret(),
    p_row: {
      entity_name: result.entity_name,
      state: result.state,
      status: result.status,
      entity_type: result.entity_type,
      formation_date: result.formation_date,
      registered_agent: result.registered_agent,
      registered_agent_address: result.registered_agent_address,
      officers: result.officers,
      managing_members: result.managing_members,
      cost: result.cost,
      raw: result.raw ?? {},
      looked_up_at: new Date().toISOString(),
    },
  });
  if (error) console.warn('[opensos] cache write failed', error.message);
}

async function readCache(entityName: string, state: string): Promise<OpenSosResult | null> {
  if (!hasSupabase()) return null;
  const { data, error } = await getSupabase().rpc('fetch_permit_parcel_opensos', {
    p_secret: ingestSecret(),
    p_entity_name: entityName,
    p_state: state,
  });
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (!row.ok && row.entity_name == null) return null;
  if (row.found === false) return null;
  return {
    entity_name: String(row.entity_name ?? entityName),
    state: String(row.state ?? state),
    status: str(row.status),
    entity_type: str(row.entity_type),
    formation_date: str(row.formation_date),
    registered_agent: str(row.registered_agent),
    registered_agent_address: str(row.registered_agent_address),
    officers: Array.isArray(row.officers) ? (row.officers as OpenSosOfficer[]) : [],
    managing_members: Array.isArray(row.managing_members)
      ? (row.managing_members as string[])
      : [],
    cost: 0,
    cached: true,
  };
}

/**
 * OpenSOS entity → officer lookup.
 * Call only for local_llc owners. Writes to Supabase; returns compact result.
 */
export async function openSosLookup(opts: {
  entity_name: string;
  state?: string;
  force?: boolean;
  /** Skip local_llc gate when caller already classified */
  allow_non_llc?: boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  owner_type?: string;
  result?: OpenSosResult;
  error?: string;
  supabase_written: boolean;
}> {
  const entity = opts.entity_name.trim();
  const state = (opts.state || 'TX').toUpperCase();
  if (!entity) {
    return { ok: false, error: 'entity_name required', supabase_written: false };
  }

  const ownerType = classifyOwnerType(entity);
  if (!opts.allow_non_llc && ownerType === 'institutional') {
    return {
      ok: false,
      skipped: true,
      reason: 'institutional owner — decision maker is typically an out-of-state fund manager',
      owner_type: ownerType,
      supabase_written: false,
    };
  }
  if (!opts.allow_non_llc && ownerType === 'individual') {
    return {
      ok: false,
      skipped: true,
      reason: 'individual owner — OpenSOS not needed; owner is the decision maker',
      owner_type: ownerType,
      supabase_written: false,
    };
  }
  if (!opts.allow_non_llc && ownerType !== 'local_llc' && ownerType !== 'unknown') {
    return {
      ok: false,
      skipped: true,
      reason: `owner_type=${ownerType}; OpenSOS reserved for local_llc`,
      owner_type: ownerType,
      supabase_written: false,
    };
  }

  if (!opts.force) {
    const cached = await readCache(entity, state);
    if (cached) {
      return { ok: true, owner_type: ownerType, result: cached, supabase_written: true };
    }
  }

  if (config.demoMode) {
    const demo: OpenSosResult = {
      entity_name: entity.toUpperCase(),
      state,
      status: 'Active',
      entity_type: 'Limited Liability Company',
      formation_date: '2018-03-15',
      registered_agent: 'Demo Registered Agent LLC',
      registered_agent_address: '100 Main St, Dallas, TX 75201',
      officers: [{ name: 'Jordan Lee', title: 'Managing Member' }],
      managing_members: ['Jordan Lee'],
      cost: 0,
      cached: false,
    };
    await cacheLookup(demo);
    return { ok: true, owner_type: ownerType, result: demo, supabase_written: hasSupabase() };
  }

  if (!config.openSosApiKey) {
    return {
      ok: false,
      error: 'OPENSOSDATA_API_KEY not configured',
      owner_type: ownerType,
      supabase_written: false,
    };
  }

  try {
    const res = await fetch(`${config.openSosBaseUrl}/v1/lookup`, {
      method: 'POST',
      headers: {
        'x-api-key': config.openSosApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entity_name: entity, state }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: `OpenSOS HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`,
        owner_type: ownerType,
        supabase_written: false,
      };
    }
    if (body.success === false) {
      return {
        ok: false,
        error: str(body.error) || 'No match',
        owner_type: ownerType,
        supabase_written: false,
      };
    }
    const data = (body.data as Record<string, unknown>) || body;
    const officers = officersFrom(data);
    const result: OpenSosResult = {
      entity_name: str(data.entityName) || str(data.entity_name) || entity.toUpperCase(),
      state,
      status: str(data.status),
      entity_type: str(data.entityType) || str(data.entity_type),
      formation_date: str(data.formationDate) || str(data.formation_date),
      registered_agent: str(data.registeredAgentName) || str(data.registered_agent),
      registered_agent_address: [
        str(data.registeredAgentAddress),
        str(data.registeredAgentCity),
        str(data.registeredAgentState),
      ]
        .filter(Boolean)
        .join(', ') || str(data.registered_agent_address),
      officers,
      managing_members: managingMembersFrom(data, officers),
      cost: Number(body.cost ?? 0.0314),
      cached: Boolean(data.cached),
      raw: data,
    };
    await cacheLookup(result);
    return { ok: true, owner_type: ownerType, result, supabase_written: hasSupabase() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenSOS lookup failed',
      owner_type: ownerType,
      supabase_written: false,
    };
  }
}
