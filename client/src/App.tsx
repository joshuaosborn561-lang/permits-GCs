import { useEffect, useMemo, useState } from 'react';

type ParsedParams = {
  location_type: string;
  location_value: string;
  radius_miles: number | null;
  property_type: string;
  max_records: number;
  ambiguous?: boolean;
  ambiguity_options?: string[];
  ambiguity_reason?: string | null;
};

type CostEstimate = {
  step1_propwire: number;
  step2_openai: number;
  step3_loopnet: number;
  step4_google: number;
  step5_contacts_note: string;
  total_low: number;
  total_high: number;
  assumptions: string[];
  disclaimer: string;
};

type Run = {
  id: string;
  natural_language_query: string;
  parsed_params: ParsedParams;
  status: string;
  current_step: string | null;
  progress: Record<string, number>;
  total_records: number;
  total_cost_estimate: number;
  total_cost_actual: number;
  cost_estimate_detail: CostEstimate | null;
  error_message: string | null;
  property_count: number;
  contact_count: number;
};

type ExportRow = {
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_source: string | null;
  match_confidence: string | null;
  property_manager_company: string | null;
  pm_confidence: string | null;
  pm_source: string | null;
  owner_entity_name: string | null;
  owner_type: string | null;
  care_of_company: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export default function App() {
  const [query, setQuery] = useState(
    'Get me all commercial property owners in Fort Worth, TX — 100 records',
  );
  const [maxOverride, setMaxOverride] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [filterQ, setFilterQ] = useState('');
  const [filterConf, setFilterConf] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [health, setHealth] = useState<Record<string, boolean | string> | null>(null);

  useEffect(() => {
    api<{ demoMode: boolean; supabaseConfigured: boolean; openaiConfigured: boolean; apifyConfigured: boolean }>(
      '/api/health',
    )
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!run || (run.status !== 'running' && run.status !== 'awaiting_confirmation')) return;
    if (run.status === 'awaiting_confirmation') return;

    const t = setInterval(async () => {
      try {
        const data = await api<{ run: Run }>(`/api/runs/${run.id}`);
        setRun(data.run);
        if (data.run.status === 'completed' || data.run.status === 'failed') {
          const results = await api<{ rows: ExportRow[] }>(`/api/runs/${run.id}/results`);
          setRows(results.rows);
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);

    return () => clearInterval(t);
  }, [run?.id, run?.status]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterConf && r.pm_confidence !== filterConf) return false;
      if (filterSource && r.contact_source !== filterSource) return false;
      if (!filterQ) return true;
      const hay = [
        r.contact_name,
        r.contact_email,
        r.property_manager_company,
        r.owner_entity_name,
        r.address,
        r.city,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(filterQ.toLowerCase());
    });
  }, [rows, filterQ, filterConf, filterSource]);

  async function onParse() {
    setBusy(true);
    setError(null);
    setRows([]);
    try {
      const data = await api<{
        run: Run;
        estimate: CostEstimate;
        ambiguous: boolean;
      }>('/api/runs/parse', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      setRun(data.run);
      setEstimate(data.estimate);
      setAmbiguous(data.ambiguous);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setBusy(false);
    }
  }

  async function onResolveLocation(location_value: string) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ run: Run; estimate: CostEstimate }>(
        `/api/runs/${run.id}/resolve-location`,
        {
          method: 'POST',
          body: JSON.stringify({ location_value }),
        },
      );
      setRun(data.run);
      setEstimate(data.estimate);
      setAmbiguous(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed');
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ run: Run }>(`/api/runs/${run.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ max_records: maxOverride }),
      });
      setRun(data.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  const p = run?.progress || {};

  return (
    <div className="app">
      <header className="brand-bar">
        <div>
          <div className="brand">
            SalesGlider <span>PM Finder</span>
          </div>
          <div className="brand-meta">Commercial owner → property manager → decision maker</div>
        </div>
        <div className="actions">
          {health?.demoMode ? <span className="pill warn">Demo mode</span> : <span className="pill ok">Live mode</span>}
          {health?.supabaseConfigured ? (
            <span className="pill ok">Supabase</span>
          ) : (
            <span className="pill">No Supabase key</span>
          )}
        </div>
      </header>

      <section className="panel">
        <h2>Natural language request</h2>
        <p className="sub">
          Describe the market pull. We parse location, estimate cost, and wait for your confirm before spending.
        </p>
        <div className="input-row">
          <textarea
            className="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Get me all commercial property owners in Fort Worth, TX"
          />
          <div className="actions">
            <label className="muted">
              Sample size override{' '}
              <input
                type="number"
                min={1}
                max={50000}
                value={maxOverride}
                onChange={(e) => setMaxOverride(Number(e.target.value) || 100)}
                style={{
                  width: 90,
                  marginLeft: 8,
                  background: 'rgba(15,20,18,0.7)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  borderRadius: 8,
                  padding: '6px 8px',
                }}
              />
            </label>
            <button className="btn btn-primary" disabled={busy || !query.trim()} onClick={onParse}>
              Parse & estimate
            </button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      {run && estimate && (
        <section className="panel">
          <h2>Parsed parameters & cost estimate</h2>
          <p className="sub">
            {run.parsed_params.location_type} · {run.parsed_params.location_value}
            {run.parsed_params.radius_miles ? ` · ${run.parsed_params.radius_miles} mi` : ''} · max{' '}
            {maxOverride} records (override for this confirm)
          </p>

          {ambiguous && (
            <div>
              <p className="sub">
                Location looks ambiguous. {run.parsed_params.ambiguity_reason || 'Pick one before running.'}
              </p>
              <div className="option-list">
                {(run.parsed_params.ambiguity_options || []).map((opt) => (
                  <button key={opt} className="option" disabled={busy} onClick={() => onResolveLocation(opt)}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="estimate">
            <div>
              Estimated spend:{' '}
              <strong>
                ${estimate.total_low.toFixed(2)} – ${estimate.total_high.toFixed(2)}
              </strong>
            </div>
            <ul>
              <li>Step 1 Propwire: ${estimate.step1_propwire.toFixed(4)}</li>
              <li>Step 2 OpenAI parse: ${estimate.step2_openai.toFixed(4)}</li>
              <li>Step 3 LoopNet: ${estimate.step3_loopnet.toFixed(4)}</li>
              <li>Step 4 Google: ${estimate.step4_google.toFixed(4)}</li>
              <li>{estimate.step5_contacts_note}</li>
              <li>{estimate.disclaimer}</li>
            </ul>
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button
              className="btn btn-primary"
              disabled={busy || ambiguous || run.status === 'running' || run.status === 'completed'}
              onClick={onConfirm}
            >
              Confirm & run pipeline
            </button>
            {run.status === 'running' && (
              <span className="pill warn">
                <span className="pulse" /> {run.current_step || 'running'}
              </span>
            )}
            {run.status === 'completed' && <span className="pill ok">Completed</span>}
            {run.status === 'failed' && <span className="pill bad">Failed</span>}
          </div>
          {run.error_message && <div className="error">{run.error_message}</div>}
        </section>
      )}

      {run && (run.status === 'running' || run.status === 'completed' || run.status === 'failed') && (
        <section className="panel">
          <h2>Live status</h2>
          <p className="sub">
            Actual cost so far: <strong>${Number(run.total_cost_actual || 0).toFixed(4)}</strong>
            {' · '}
            getleads contacts do not add to the dollar total.
          </p>
          <div className="grid-stats">
            <Stat label="Pulled" value={p.records_pulled} />
            <Stat label="c/o resolved" value={p.resolved_co} />
            <Stat label="LoopNet" value={p.resolved_loopnet} />
            <Stat label="Google PM" value={p.resolved_google} />
            <Stat label="Unresolved" value={p.unresolved} />
            <Stat label="Google used" value={p.google_searches_used} />
            <Stat label="Contacts" value={p.contacts_found} />
            <Stat label="via getleads ($0)" value={p.contacts_from_getleads} />
            <Stat label="via AI Ark" value={p.contacts_from_ai_ark} />
            <Stat label="via LeadMagic" value={p.contacts_from_leadmagic} />
            <Stat label="via cache" value={p.contacts_from_cache} />
            <Stat label="Failed step 1" value={p.failed_step_1} />
          </div>
        </section>
      )}

      {(run?.status === 'completed' || rows.length > 0) && (
        <section className="panel">
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <h2>Results (contact level)</h2>
              <p className="sub" style={{ marginBottom: 0 }}>
                One row per decision-maker contact with property/owner/PM fields joined.
              </p>
            </div>
            {run && (
              <a className="btn btn-ghost" href={`/api/runs/${run.id}/export.csv`}>
                Export CSV
              </a>
            )}
          </div>

          <div className="filters">
            <input
              placeholder="Search name, company, address…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
            />
            <select value={filterConf} onChange={(e) => setFilterConf(e.target.value)}>
              <option value="">All PM confidence</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
              <option value="unresolved">unresolved</option>
            </select>
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
              <option value="">All contact sources</option>
              <option value="getleads">getleads</option>
              <option value="ai_ark">ai_ark</option>
              <option value="leadmagic">leadmagic</option>
              <option value="google_search">google_search</option>
              <option value="cache">cache</option>
            </select>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Title</th>
                  <th>Email</th>
                  <th>Source</th>
                  <th>PM company</th>
                  <th>PM conf</th>
                  <th>Owner</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => (
                  <tr key={`${r.contact_email}-${r.address}-${i}`}>
                    <td>{r.contact_name || '—'}</td>
                    <td>{r.contact_title || '—'}</td>
                    <td>{r.contact_email || '—'}</td>
                    <td>
                      {r.contact_source === 'getleads' ? (
                        <span className="pill ok">getleads $0</span>
                      ) : (
                        r.contact_source || '—'
                      )}
                    </td>
                    <td>{r.property_manager_company || '—'}</td>
                    <td>{r.pm_confidence || '—'}</td>
                    <td>{r.owner_entity_name || '—'}</td>
                    <td>{r.address || '—'}</td>
                  </tr>
                ))}
                {!filteredRows.length && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No rows yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value ?? 0}</div>
    </div>
  );
}
