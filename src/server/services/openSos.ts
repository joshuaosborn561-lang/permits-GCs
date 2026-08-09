import { config } from '../config.js';
import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import type { OpenSosOfficer, OpenSosResult } from '../types.js';
import { classifyOwnerType } from './ownerType.js';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function currentYm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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

export async function getOpenSosUsage(): Promise<{
  ym: string;
  used: number;
  limit: number;
  remaining: number;
  total_cost: number;
  cost_per_lookup: number;
}> {
  const ym = currentYm();
  const limit = config.openSosMonthlyLimit;
  if (!hasSupabase()) {
    return {
      ym,
      used: 0,
      limit,
      remaining: limit,
      total_cost: 0,
      cost_per_lookup: config.openSosCostPerLookup,
    };
  }
  const { data, error } = await getSupabase().rpc('count_opensos_usage', {
    p_secret: ingestSecret(),
    p_ym: ym,
  });
  if (error) {
    console.warn('[opensos] count usage failed', error.message);
    return {
      ym,
      used: 0,
      limit,
      remaining: limit,
      total_cost: 0,
      cost_per_lookup: config.openSosCostPerLookup,
    };
  }
  const used = Number((data as { used?: number })?.used ?? 0);
  return {
    ym,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    total_cost: Number((data as { total_cost?: number })?.total_cost ?? 0),
    cost_per_lookup: config.openSosCostPerLookup,
  };
}

async function recordUsage(entityName: string, state: string, cost: number): Promise<void> {
  if (!hasSupabase()) return;
  const { error } = await getSupabase().rpc('record_opensos_usage', {
    p_secret: ingestSecret(),
    p_entity_name: entityName,
    p_state: state,
    p_cost: cost,
  });
  if (error) console.warn('[opensos] record usage failed', error.message);
}

function classifyGate(
  entity: string,
  allowNonLlc?: boolean,
): { ok: true; owner_type: string } | { ok: false; skipped: true; reason: string; owner_type: string } {
  const ownerType = classifyOwnerType(entity);
  if (!allowNonLlc && ownerType === 'institutional') {
    return {
      ok: false,
      skipped: true,
      reason: 'institutional owner — decision maker is typically an out-of-state fund manager',
      owner_type: ownerType,
    };
  }
  if (!allowNonLlc && ownerType === 'individual') {
    return {
      ok: false,
      skipped: true,
      reason: 'individual owner — OpenSOS not needed; owner is the decision maker',
      owner_type: ownerType,
    };
  }
  if (!allowNonLlc && ownerType !== 'local_llc' && ownerType !== 'unknown') {
    return {
      ok: false,
      skipped: true,
      reason: `owner_type=${ownerType}; OpenSOS reserved for local_llc`,
      owner_type: ownerType,
    };
  }
  return { ok: true, owner_type: ownerType };
}

export interface OpenSosEstimate {
  ok: boolean;
  ym: string;
  monthly_limit: number;
  monthly_used: number;
  monthly_remaining: number;
  entities_requested: number;
  would_skip: number;
  would_use_cache: number;
  estimated_live_requests: number;
  estimated_cost_usd: number;
  within_monthly_limit: boolean;
  needs_approval: boolean;
  approval_phrase: string;
  assistant_instructions: string;
  entities: Array<{
    entity_name: string;
    state: string;
    owner_type: string;
    action: 'live' | 'cache' | 'skip';
    reason?: string;
  }>;
  error?: string;
}

/** Estimate live OpenSOS requests before spending. Never calls the paid API. */
export async function openSosEstimate(opts: {
  entity_names: string[];
  state?: string;
  force?: boolean;
  allow_non_llc?: boolean;
}): Promise<OpenSosEstimate> {
  const state = (opts.state || 'TX').toUpperCase();
  const names = [...new Set(opts.entity_names.map((n) => n.trim()).filter(Boolean))];
  const usage = await getOpenSosUsage();
  const entities: OpenSosEstimate['entities'] = [];

  for (const name of names) {
    const gate = classifyGate(name, opts.allow_non_llc);
    if (!gate.ok) {
      entities.push({
        entity_name: name,
        state,
        owner_type: gate.owner_type,
        action: 'skip',
        reason: gate.reason,
      });
      continue;
    }
    if (!opts.force) {
      const cached = await readCache(name, state);
      if (cached) {
        entities.push({
          entity_name: name,
          state,
          owner_type: gate.owner_type,
          action: 'cache',
        });
        continue;
      }
    }
    entities.push({
      entity_name: name,
      state,
      owner_type: gate.owner_type,
      action: 'live',
    });
  }

  const live = entities.filter((e) => e.action === 'live').length;
  const cacheHits = entities.filter((e) => e.action === 'cache').length;
  const skipped = entities.filter((e) => e.action === 'skip').length;
  const within = live <= usage.remaining;
  const estimatedCost = Number((live * config.openSosCostPerLookup).toFixed(4));

  return {
    ok: true,
    ym: usage.ym,
    monthly_limit: usage.limit,
    monthly_used: usage.used,
    monthly_remaining: usage.remaining,
    entities_requested: names.length,
    would_skip: skipped,
    would_use_cache: cacheHits,
    estimated_live_requests: live,
    estimated_cost_usd: estimatedCost,
    within_monthly_limit: within,
    needs_approval: live > 0,
    approval_phrase: 'approve opensos' ,
    assistant_instructions:
      live === 0
        ? 'No live OpenSOS calls needed (cache/skip only). You may call opensos_lookup without confirm_spend for cache hits.'
        : within
          ? `STOP. Show the user: ${live} live OpenSOS request(s) ≈ $${estimatedCost} this run; monthly ${usage.used}/${usage.limit} used (${usage.remaining} left). Wait for explicit approval (e.g. "approve opensos" / "confirm"). Only then call opensos_lookup with confirm_spend=true. Do NOT run live lookups without approval.`
          : `STOP. Estimated ${live} live requests exceeds monthly remaining (${usage.remaining}/${usage.limit}). Do not run. Ask the user to reduce the set or wait until next month.`,
    entities,
  };
}

/**
 * OpenSOS entity → officer lookup.
 * Live API calls require confirm_spend=true after opensos_estimate + human approval.
 * Cache hits are free and do not require confirm_spend.
 */
export async function openSosLookup(opts: {
  entity_name: string;
  state?: string;
  force?: boolean;
  allow_non_llc?: boolean;
  /** Required for any live (paid) OpenSOS HTTP call */
  confirm_spend?: boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  owner_type?: string;
  result?: OpenSosResult;
  error?: string;
  supabase_written: boolean;
  live_request?: boolean;
  usage?: Awaited<ReturnType<typeof getOpenSosUsage>>;
  needs_approval?: boolean;
  estimate_hint?: string;
}> {
  const entity = opts.entity_name.trim();
  const state = (opts.state || 'TX').toUpperCase();
  if (!entity) {
    return { ok: false, error: 'entity_name required', supabase_written: false };
  }

  const gate = classifyGate(entity, opts.allow_non_llc);
  if (!gate.ok) {
    return {
      ok: false,
      skipped: true,
      reason: gate.reason,
      owner_type: gate.owner_type,
      supabase_written: false,
    };
  }

  if (!opts.force) {
    const cached = await readCache(entity, state);
    if (cached) {
      return {
        ok: true,
        owner_type: gate.owner_type,
        result: cached,
        supabase_written: true,
        live_request: false,
        usage: await getOpenSosUsage(),
      };
    }
  }

  // Live path — approval + monthly quota required
  if (opts.confirm_spend !== true) {
    const est = await openSosEstimate({
      entity_names: [entity],
      state,
      force: opts.force,
      allow_non_llc: opts.allow_non_llc,
    });
    return {
      ok: false,
      error:
        'Live OpenSOS lookup blocked: call opensos_estimate, show the user estimated_live_requests + cost, get explicit approval, then retry with confirm_spend=true.',
      owner_type: gate.owner_type,
      supabase_written: false,
      needs_approval: true,
      live_request: true,
      usage: await getOpenSosUsage(),
      estimate_hint: est.assistant_instructions,
    };
  }

  const usage = await getOpenSosUsage();
  if (usage.remaining < 1) {
    return {
      ok: false,
      error: `OpenSOS monthly limit reached (${usage.used}/${usage.limit} for ${usage.ym}). No live lookups until next month.`,
      owner_type: gate.owner_type,
      supabase_written: false,
      usage,
      live_request: true,
    };
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
    return {
      ok: true,
      owner_type: gate.owner_type,
      result: demo,
      supabase_written: hasSupabase(),
      live_request: false,
      usage: await getOpenSosUsage(),
    };
  }

  if (!config.openSosApiKey) {
    return {
      ok: false,
      error: 'OPENSOSDATA_API_KEY not configured',
      owner_type: gate.owner_type,
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
        owner_type: gate.owner_type,
        supabase_written: false,
        live_request: true,
        usage: await getOpenSosUsage(),
      };
    }
    if (body.success === false) {
      // Still counts as a billed attempt at many SOS providers — record usage
      const cost = Number(body.cost ?? config.openSosCostPerLookup);
      await recordUsage(entity, state, cost);
      return {
        ok: false,
        error: str(body.error) || 'No match',
        owner_type: gate.owner_type,
        supabase_written: false,
        live_request: true,
        usage: await getOpenSosUsage(),
      };
    }
    const data = (body.data as Record<string, unknown>) || body;
    const officers = officersFrom(data);
    const cost = Number(body.cost ?? config.openSosCostPerLookup);
    const result: OpenSosResult = {
      entity_name: str(data.entityName) || str(data.entity_name) || entity.toUpperCase(),
      state,
      status: str(data.status),
      entity_type: str(data.entityType) || str(data.entity_type),
      formation_date: str(data.formationDate) || str(data.formation_date),
      registered_agent: str(data.registeredAgentName) || str(data.registered_agent),
      registered_agent_address:
        [
          str(data.registeredAgentAddress),
          str(data.registeredAgentCity),
          str(data.registeredAgentState),
        ]
          .filter(Boolean)
          .join(', ') || str(data.registered_agent_address),
      officers,
      managing_members: managingMembersFrom(data, officers),
      cost,
      cached: Boolean(data.cached),
      raw: data,
    };
    await cacheLookup(result);
    await recordUsage(result.entity_name, state, cost);
    return {
      ok: true,
      owner_type: gate.owner_type,
      result,
      supabase_written: hasSupabase(),
      live_request: true,
      usage: await getOpenSosUsage(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenSOS lookup failed',
      owner_type: gate.owner_type,
      supabase_written: false,
      live_request: true,
    };
  }
}
