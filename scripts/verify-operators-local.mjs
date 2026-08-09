/**
 * Local acceptance check for build_operators logic (no Supabase write).
 * Run: node scripts/verify-operators-local.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use tsx-compiled path via dynamic import of dist if present, else fail with hint.
const root = new URL('..', import.meta.url);

async function main() {
  // Load via tsx register by spawning is easier — inline the pure helpers by importing built JS.
  let operators;
  try {
    operators = await import(pathToFileURL(`${root.pathname}/dist/server/services/operators.js`).href);
  } catch {
    console.error('Build first: npm run build:server');
    process.exit(1);
  }
  const parcels = await import(pathToFileURL(`${root.pathname}/dist/server/services/parcels.js`).href);
  const { normalizeMailingAddress, extractMailingState, isTaxDepartmentAddress, isMunicipalOwnerName } =
    operators;
  const { loadParcels } = parcels;

  // Unit checks
  const n1 = normalizeMailingAddress('C/O TAX DEPT 2323 ROSS AVE STE 200 DALLAS TX 75201');
  console.log('normalize care-of+tax:', n1?.key);
  console.log('tax dept?', isTaxDepartmentAddress(n1.key));
  console.log('state PA?', extractMailingState('1 MAIN ST, PHILADELPHIA, PA 19428'));
  console.log('state CO spelled?', extractMailingState('HIGHLANDS RANCH COLORADO 80129'));
  console.log('municipal?', isMunicipalOwnerName('CITY OF MCKINNEY'));

  const all = loadParcels();
  console.log('parcels loaded', all.length);

  const ownerTypes = {};
  for (const p of all) {
    ownerTypes[p.owner_type] = (ownerTypes[p.owner_type] || 0) + 1;
  }
  console.log('owner_type', ownerTypes);

  const homeStates = new Set(['TX']);
  const byAddr = new Map();
  const excluded = { no_mailing: 0, out_of_state: 0, municipal: 0, tax_department: 0 };

  for (const p of all) {
    const norm = normalizeMailingAddress(p.mailing_address);
    if (!norm) {
      excluded.no_mailing++;
      continue;
    }
    if (isTaxDepartmentAddress(norm.key)) {
      excluded.tax_department++;
      continue;
    }
    if (isMunicipalOwnerName(p.owner_name) || p.owner_type === 'municipal') {
      excluded.municipal++;
      continue;
    }
    const st = extractMailingState(norm.key);
    if (st && !homeStates.has(st)) {
      excluded.out_of_state++;
      continue;
    }
    let agg = byAddr.get(norm.key);
    if (!agg) {
      agg = { parcels: 0, llcs: new Set(), value: 0 };
      byAddr.set(norm.key, agg);
    }
    agg.parcels++;
    agg.value += p.assessed_value ?? 0;
    if (p.owner_name) agg.llcs.add(p.owner_name.toUpperCase());
  }

  let defaults = 0;
  let prime = 0;
  for (const agg of byAddr.values()) {
    if (agg.parcels >= 2 && agg.llcs.size >= 1) defaults++;
    if (agg.llcs.size >= 3 && agg.value >= 5_000_000) prime++;
  }
  console.log('excluded', excluded);
  console.log('operators defaults (min_parcels=2)', defaults);
  console.log('operators prime (min_llcs=3, $5M)', prime);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
