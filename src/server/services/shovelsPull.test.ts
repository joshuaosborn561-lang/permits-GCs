import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { tokenizeGeos } from './shovelsGeoTargets.js';
import {
  loadShovelsContractors,
  matchingShovelsContractors,
  setContractorsDataDirForTests,
  upsertShovelsContractorsIntoStore,
} from './shovelsContractors.js';
import {
  loadPullState,
  makeFixtureFetchPage,
  shovelsPull,
} from './shovelsPull.js';

function seedEmptyStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const header = [
    'id',
    'name',
    'business_name',
    'dba',
    'phone',
    'primary_phone',
    'email',
    'primary_email',
    'website',
    'linkedin_url',
    'employee_count',
    'address_street',
    'address_city',
    'address_state',
    'address_zip',
    'places',
    'permit_count',
    'total_job_value',
    'primary_industry',
    'business_type',
  ].join(',');
  const row = [
    'dallas1',
    'A',
    'Dallas Co',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'TX',
    '',
    'Dallas',
    '1',
    '',
    '',
    '',
  ].join(',');
  writeFileSync(join(dir, 'commercial_contractors_contacts.csv'), `${header}\n${row}\n`, 'utf8');
}

describe('shovels_pull store integration (fixtures only — no live API)', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'shovels-pull-'));
    seedEmptyStore(dir);
    setContractorsDataDirForTests(dir);
  });

  after(() => {
    setContractorsDataDirForTests(null);
  });

  it('delimiter: Denton County, TX; Collin County, TX → exactly two geos, no Azle', () => {
    const tokens = tokenizeGeos('Denton County, TX; Collin County, TX');
    assert.deepEqual(tokens, ['Denton County, TX', 'Collin County, TX']);
  });

  it('dry_run resolves without fetching or writing', async () => {
    const before = loadShovelsContractors(true).length;
    const result = await shovelsPull({
      geos: 'Denton County, TX',
      max_records: 50,
      dry_run: true,
      resolveGeo: async () => ({
        geo_id: '63FDGkZW8pk',
        name: 'Denton County, TX',
        state: 'TX',
        kind: 'county',
      }),
    });
    assert.equal(result.dry_run, true);
    assert.equal(result.spends_shovels_credits, false);
    assert.equal(result.records_fetched, 0);
    assert.equal(result.requests_used, 0);
    assert.equal(loadShovelsContractors(true).length, before);
    const geos = result.geos as Array<{ resolved_geo_id: string }>;
    assert.equal(geos[0]!.resolved_geo_id, '63FDGkZW8pk');
  });

  it('max_records is a hard stop before the next request', async () => {
    const fetchPage = makeFixtureFetchPage([
      {
        items: [
          { id: 'a', name: 'A', business_name: 'A LLC', address: { city: 'Denton', state: 'TX' } },
          { id: 'b', name: 'B', business_name: 'B LLC', address: { city: 'Denton', state: 'TX' } },
        ],
        next_cursor: 'c2',
        credits_request: 2,
        credits_remaining: 200,
      },
      {
        items: [
          { id: 'c', name: 'C', business_name: 'C LLC', address: { city: 'Denton', state: 'TX' } },
        ],
        next_cursor: null,
        credits_request: 1,
        credits_remaining: 199,
      },
    ]);

    const result = await shovelsPull({
      geos: 'Denton County, TX',
      max_records: 2,
      page_size: 100,
      min_credits_remaining: 1,
      reset_cursor: true,
      fetchPage,
      resolveGeo: async () => ({
        geo_id: '63FDGkZW8pk',
        name: 'Denton County, TX',
        state: 'TX',
        kind: 'county',
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.records_fetched, 2);
    assert.ok((result.requests_used as number) <= 1, 'must not fetch a second page once max_records hit');
    assert.equal(result.requests_remaining, 200);
    assert.ok(result.credits_remaining != null);

    const denton = matchingShovelsContractors({ place: 'Denton_County' });
    assert.equal(denton.length, 2);
    assert.ok(loadShovelsContractors(true).some((r) => r.places.includes('Dallas')));
  });

  it('dedupes on id and unions places so query(place=Denton_County) works', () => {
    const upsert = upsertShovelsContractorsIntoStore([
      {
        id: 'dallas1',
        name: 'A',
        business_name: 'Dallas Co',
        dba: null,
        phone: null,
        primary_phone: null,
        email: null,
        primary_email: null,
        website: null,
        linkedin_url: null,
        employee_count: null,
        address_street: null,
        address_city: null,
        address_state: 'TX',
        address_zip: null,
        places: ['Denton_County'],
        permit_count: 1,
        total_job_value: null,
        primary_industry: null,
        business_type: null,
      },
    ]);
    assert.equal(upsert.updated, 1);
    const row = matchingShovelsContractors({ place: 'Denton_County' }).find((r) => r.id === 'dallas1');
    assert.ok(row);
    assert.ok(row!.places.includes('Dallas'));
    assert.ok(row!.places.includes('Denton_County'));
  });

  it('persists cursor for resume after stop', async () => {
    // Fresh store for this case
    seedEmptyStore(dir);
    setContractorsDataDirForTests(dir);

    let calls = 0;
    const fetchPage = makeFixtureFetchPage([
      {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `p1-${i}`,
          name: `N${i}`,
          business_name: `Co${i}`,
          address: { city: 'Denton', state: 'TX' },
        })),
        next_cursor: 'RESUME_ME',
        credits_request: 50,
        credits_remaining: 150,
      },
    ]);

    const first = await shovelsPull({
      geos: 'Denton County, TX',
      max_records: 50,
      page_size: 50,
      min_credits_remaining: 1,
      reset_cursor: true,
      fetchPage: async (opts) => {
        calls += 1;
        return fetchPage(opts);
      },
      resolveGeo: async () => ({
        geo_id: '63FDGkZW8pk',
        name: 'Denton County, TX',
        state: 'TX',
        kind: 'county',
      }),
    });
    assert.equal(first.records_fetched, 50);
    assert.equal(calls, 1);

    const state = loadPullState();
    const job = Object.values(state.jobs)[0];
    assert.ok(job);
    assert.equal(job!.cursor, 'RESUME_ME');
    assert.equal(job!.done, false);
    assert.ok(existsSync(join(dir, 'pull_state.json')));
    assert.ok(readFileSync(join(dir, 'pull_state.json'), 'utf8').includes('RESUME_ME'));
  });
});
