import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import { supabaseTargetMeta } from '../lib/supabaseTarget.js';
import { matchingShovelsContractors, type ContractorQuery } from './shovelsContractors.js';
import { syncContractorsToSupabase } from './syncToSupabase.js';

export interface CallingListMeta {
  id: string;
  name: string;
  owner: string;
  source: string;
  filters: Record<string, unknown>;
  row_count: number;
  created_at?: string;
  updated_at?: string;
}

function slugOwner(owner: string): string {
  return owner.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'shared';
}

function defaultListName(q: ContractorQuery, owner: string): string {
  const bits = ['Shovels GCs'];
  if (q.place) bits.push(String(q.place).replace(/_/g, ' '));
  if (q.city) bits.push(q.city);
  if (q.has_phone === true) bits.push('has phone');
  if (q.has_email === true) bits.push('has email');
  if (q.q) bits.push(`“${q.q}”`);
  bits.push(`for ${owner}`);
  return bits.join(' · ');
}

export async function upsertCallingListMeta(list: CallingListMeta): Promise<string | null> {
  if (!hasSupabase()) return 'Supabase not configured';
  const { error } = await getSupabase().rpc('upsert_permit_parcel_calling_list', {
    p_secret: ingestSecret(),
    p_list: {
      id: list.id,
      name: list.name,
      owner: slugOwner(list.owner),
      source: list.source,
      filters: list.filters,
      row_count: list.row_count,
    },
  });
  return error ? error.message : null;
}

export async function saveCallingList(opts: {
  name?: string;
  owner?: string;
  contractor_query?: ContractorQuery;
}): Promise<Record<string, unknown>> {
  const owner = slugOwner(opts.owner || 'shared');
  const q = opts.contractor_query ?? {};
  const name = (opts.name || defaultListName(q, owner)).trim();
  const matched = matchingShovelsContractors(q).length;

  const sync = await syncContractorsToSupabase(q, {
    list_name: name,
    owner,
  });

  if (sync.ok) {
    const metaErr = await upsertCallingListMeta({
      id: sync.scrape_job_id,
      name,
      owner,
      source: 'shovels_contractors',
      filters: q as Record<string, unknown>,
      row_count: Number(sync.counts.contractors_matched ?? matched),
    });
    if (metaErr) {
      return {
        ...sync,
        ok: false,
        error: `Leads wrote but calling-list catalog failed: ${metaErr}`,
      };
    }
  }

  return {
    ...sync,
    list: {
      id: sync.scrape_job_id,
      name,
      owner,
      source: 'shovels_contractors',
      row_count: Number(sync.counts.contractors_matched ?? matched),
    },
    assistant_instructions:
      'List is in Supabase. Tell the user the list id + owner. Cayden (or anyone) filters it with list_calling_lists / query_calling_list (has_phone, city, q). Do not dump all rows into chat.',
    supabase: supabaseTargetMeta(),
  };
}

export async function listCallingLists(opts: {
  owner?: string;
  q?: string;
  limit?: number;
} = {}): Promise<Record<string, unknown>> {
  if (!hasSupabase()) {
    return { ok: false, error: 'Supabase not configured', lists: [], count: 0 };
  }
  const { data, error } = await getSupabase().rpc('list_permit_parcel_calling_lists', {
    p_secret: ingestSecret(),
    p_owner: opts.owner ? slugOwner(opts.owner) : null,
    p_q: opts.q ?? null,
    p_limit: opts.limit ?? 50,
  });
  if (error) return { ok: false, error: error.message, lists: [], count: 0 };
  const payload = data as { ok?: boolean; lists?: CallingListMeta[]; count?: number };
  return {
    ok: true,
    ...supabaseTargetMeta(),
    count: payload.count ?? payload.lists?.length ?? 0,
    lists: payload.lists ?? [],
    assistant_instructions:
      'These are saved cold-calling lists in Supabase. Use query_calling_list with list_id or owner to page contacts (max 50/page). Prefer has_phone=true for dialing.',
  };
}

export async function queryCallingList(opts: {
  list_id?: string;
  owner?: string;
  q?: string;
  city?: string;
  state?: string;
  has_phone?: boolean;
  has_email?: boolean;
  dial_status?: string;
  page?: number;
  page_size?: number;
}): Promise<Record<string, unknown>> {
  if (!hasSupabase()) {
    return { ok: false, error: 'Supabase not configured', rows: [], total: 0 };
  }
  const { data, error } = await getSupabase().rpc('query_permit_parcel_calling_list', {
    p_secret: ingestSecret(),
    p_list_id: opts.list_id ?? null,
    p_owner: opts.owner ? slugOwner(opts.owner) : null,
    p_q: opts.q ?? null,
    p_city: opts.city ?? null,
    p_state: opts.state ?? null,
    p_has_phone: opts.has_phone ?? null,
    p_has_email: opts.has_email ?? null,
    p_dial_status: opts.dial_status ?? null,
    p_page: opts.page ?? 1,
    p_page_size: opts.page_size ?? 25,
  });
  if (error) return { ok: false, error: error.message, rows: [], total: 0 };
  const payload = data as Record<string, unknown>;
  return {
    ok: true,
    ...supabaseTargetMeta(),
    ...payload,
    assistant_instructions:
      'Paginate. Filter dial_status=owner_cell for Cayden. Summarize counts. Do not dump the full list into chat.',
  };
}
