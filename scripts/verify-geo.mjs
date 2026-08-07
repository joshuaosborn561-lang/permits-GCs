/**
 * Offline checks for ZIP / radius geography in the Property PM Finder.
 * Run: node scripts/verify-geo.mjs
 */
import { createRequire } from 'module';

// Use compiled JS if present; otherwise tsx path via dynamic import of source through tsx isn't needed —
// this script imports from dist after build, or we run via tsx on a tiny harness.
const require = createRequire(import.meta.url);

async function main() {
  // Prefer dist; fall back to instructing rebuild
  let zips;
  let parseQuery;
  let planMarket;
  try {
    zips = await import('../dist/server/lib/zips.js');
    parseQuery = await import('../dist/server/services/parseQuery.js');
    planMarket = await import('../dist/server/services/planMarket.js');
  } catch (err) {
    console.error('Build first: npm run build:server');
    throw err;
  }

  let failed = 0;
  const check = (name, cond, detail = '') => {
    if (cond) console.log(`PASS  ${name}`);
    else {
      failed += 1;
      console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  // 1) Explicit ZIP list
  const plannedZips = await planMarket.planMarket({
    query: 'commercial general contractors',
    zips: '75001,75002,75006',
  });
  check('explicit zips zip_count=3', plannedZips.zip_count === 3, `got ${plannedZips.zip_count}`);
  check('explicit zips mode=zips', plannedZips.mode === 'zips');
  check(
    'explicit zips persisted',
    Array.isArray(plannedZips.parsed.zips) && plannedZips.parsed.zips.length === 3,
  );

  // 2) Radius brief → TX only, ~635 STANDARD ZIPs near Dallas reference
  const plannedRadius = await planMarket.planMarket({
    query: 'commercial general contractors within 150 miles of Dallas TX',
  });
  check('radius states TX only', JSON.stringify(plannedRadius.states) === '["TX"]', JSON.stringify(plannedRadius.states));
  check('radius has center', Boolean(plannedRadius.center));
  check('radius_miles=150', plannedRadius.radius_miles === 150, String(plannedRadius.radius_miles));
  check(
    'radius zip_count in 600..950',
    plannedRadius.zip_count >= 600 && plannedRadius.zip_count <= 950,
    String(plannedRadius.zip_count),
  );
  // Shape: prefixes 750-768 dominate
  const prefixes = plannedRadius.parsed.zips.map((z) => z.slice(0, 3));
  const inBand = prefixes.filter((p) => {
    const n = Number(p);
    return n >= 750 && n <= 768;
  }).length;
  check(
    'radius ZIP shape mostly 750-768',
    inBand / plannedRadius.zip_count >= 0.85,
    `${inBand}/${plannedRadius.zip_count}`,
  );

  // Direct haversine reference at 32.7767,-97.0000
  const rows = await zips.zipsWithinRadius(32.7767, -97.0, 150, { states: ['TX'] });
  check(
    'haversine Dallas TX 150mi count',
    rows.length >= 600 && rows.length <= 950,
    String(rows.length),
  );

  // 3) Exclude categories from brief
  const excluded = parseQuery.heuristicParse(
    'Commercial GCs in Texas. Do not include roofing contractors themselves.',
  );
  check(
    'exclude roofing from brief',
    excluded.exclude_categories.some((c) => c.includes('roofing')),
    JSON.stringify(excluded.exclude_categories),
  );

  // 4) Center+radius override
  const override = await planMarket.planMarket({
    query: 'commercial property owners in Oklahoma',
    center: '32.7767,-97.0000',
    radius_miles: 150,
  });
  check('override radius wins over OK city brief for mode', override.mode === 'radius');
  check('override has zip footprint', override.zip_count > 100, String(override.zip_count));

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll geography checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
