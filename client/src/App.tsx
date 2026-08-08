import { useEffect, useState } from 'react';

type Health = {
  ok?: boolean;
  product?: string;
  demoMode?: boolean;
  supabaseConfigured?: boolean;
  openSosConfigured?: boolean;
  shovelsContractorsLoaded?: number;
  parcelsLoaded?: number;
  parcels?: {
    counties?: Record<string, number>;
    owner_type?: Record<string, number>;
  };
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(e instanceof Error ? e.message : 'health failed'));
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">SalesGlider</p>
        <h1>Permit &amp; Parcel</h1>
        <p className="lede">
          Shovels commercial GCs · DCAD / TAD / CCAD parcels · OpenSOS for local LLCs.
          Propwire cascade removed.
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      {health && (
        <section className="status">
          <h2>Loaded</h2>
          <ul>
            <li>Contractors: {health.shovelsContractorsLoaded ?? 0}</li>
            <li>Parcels: {health.parcelsLoaded ?? 0}</li>
            <li>Supabase: {health.supabaseConfigured ? 'yes' : 'no'}</li>
            <li>OpenSOS: {health.openSosConfigured ? 'yes' : 'no'}</li>
            <li>Demo: {health.demoMode ? 'on' : 'off'}</li>
          </ul>
          {health.parcels?.counties && (
            <>
              <h3>Parcels by county</h3>
              <ul>
                {Object.entries(health.parcels.counties).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v.toLocaleString()}
                  </li>
                ))}
              </ul>
            </>
          )}
          {health.parcels?.owner_type && (
            <>
              <h3>Owner type</h3>
              <ul>
                {Object.entries(health.parcels.owner_type).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v.toLocaleString()}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="mcp">
        <h2>MCP</h2>
        <p>
          Connect Claude to <code>/mcp</code> (authless). Prefer{' '}
          <code>sync_to_supabase</code> + <code>select count(*)</code> over row dumps.
        </p>
      </section>
    </div>
  );
}
