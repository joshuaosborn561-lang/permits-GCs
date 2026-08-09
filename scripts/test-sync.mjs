import { syncParcelsToSupabase } from '../dist/server/services/syncToSupabase.js';
import { collectParcelsForSync } from '../dist/server/services/parcels.js';
import { buildOperators } from '../dist/server/services/operators.js';

const mode = process.argv[2] || 'tarrant';

async function main() {
  if (mode === 'tarrant') {
    const matched = collectParcelsForSync({ county: 'Tarrant' });
    console.log('tarrant_matched', matched.parcels.length, 'source', matched.source_rows);
    const r = await syncParcelsToSupabase({ county: 'Tarrant' });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (mode === 'full') {
    const matched = collectParcelsForSync({});
    console.log('full_matched', matched.parcels.length, 'source', matched.source_rows);
    const r = await syncParcelsToSupabase({});
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (mode === 'operators') {
    const r = await buildOperators({});
    console.log(JSON.stringify(r, null, 2));
    const prime = await buildOperators({ min_llcs: 3, min_portfolio_value: 5_000_000 });
    console.log('prime', JSON.stringify(prime, null, 2));
    process.exit(r.ok && prime.ok ? 0 : 1);
  }
  console.error('usage: node scripts/test-sync.mjs [tarrant|full|operators]');
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
