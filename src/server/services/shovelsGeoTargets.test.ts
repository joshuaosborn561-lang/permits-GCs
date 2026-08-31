import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickGeo } from '../lib/shovels.js';
import { parseGeoToken, resolveGeoTargets } from './shovelsGeoTargets.js';

describe('pickGeo', () => {
  it('does not force TX when other states are present', () => {
    const geo = pickGeo(
      [
        { geo_id: 'tx1', name: 'Miami, TX', state: 'TX' },
        { geo_id: 'fl1', name: 'Miami, FL', state: 'FL' },
      ],
      'city',
      'Miami',
      'FL',
    );
    assert.equal(geo?.geo_id, 'fl1');
    assert.equal(geo?.state, 'FL');
  });

  it('picks best name match without TX preference', () => {
    const geo = pickGeo(
      [
        { geo_id: 'ca1', name: 'Los Angeles, CA', state: 'CA' },
        { geo_id: 'tx1', name: 'Los Angeles County something, TX', state: 'TX' },
      ],
      'city',
      'Los Angeles',
    );
    assert.equal(geo?.geo_id, 'ca1');
  });
});

describe('resolveGeoTargets', () => {
  it('expands east_coast and west_coast aliases', () => {
    const east = resolveGeoTargets({ geos: 'east_coast' });
    assert.ok(east.some((t) => t.place === 'Miami' && t.state === 'FL'));
    assert.ok(east.some((t) => t.place === 'New_York' && t.state === 'NY'));
    const west = resolveGeoTargets({ geos: 'west_coast' });
    assert.ok(west.some((t) => t.place === 'Los_Angeles' && t.state === 'CA'));
    assert.ok(west.some((t) => t.place === 'Seattle' && t.state === 'WA'));
  });

  it('accepts state codes and City, ST tokens', () => {
    assert.deepEqual(parseGeoToken('CA'), {
      kind: 'state',
      q: 'CA',
      place: 'CA',
      state: 'CA',
    });
    const miami = parseGeoToken('Miami, FL');
    assert.equal(miami.q, 'Miami');
    assert.equal(miami.state, 'FL');
    assert.equal(miami.kind, 'city');
  });
});
