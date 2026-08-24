import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  namesLooselyMatch,
  levenshtein,
  pickOwnerOfficer,
  TexasCpaError,
  type ComptrollerEntity,
} from './texasComptroller.js';

describe('levenshtein', () => {
  it('counts a one-character last-name typo', () => {
    assert.equal(levenshtein('CHANDRAHAS', 'CHANDRANAS'), 1);
  });
});

describe('namesLooselyMatch', () => {
  it('treats CHANDRAHAS vs CHANDRANAS as the same person', () => {
    assert.equal(namesLooselyMatch('SANJAY CHANDRAHAS', 'SANJAY CHANDRANAS'), true);
  });

  it('still matches first-initial + last name', () => {
    assert.equal(namesLooselyMatch('Sanjay K Chandrahas', 'S Chandrahas'), true);
  });

  it('does not match unrelated last names', () => {
    assert.equal(namesLooselyMatch('SANJAY CHANDRAHAS', 'SANJAY PATEL'), false);
  });
});

describe('pickOwnerOfficer', () => {
  const entity: ComptrollerEntity = {
    taxpayer_id: '1',
    name: 'TOM PLUMBER INC',
    dba: null,
    sos_file_number: null,
    right_to_transact: null,
    registered_agent: 'CT CORPORATION SYSTEM',
    officers: [
      {
        name: 'SANJAY CHANDRANAS',
        title: 'PRESIDENT',
        year: '2024',
        street: null,
        city: 'HOUSTON',
        state: 'TX',
        zip: null,
        source: 'PIR',
        is_registered_agent: false,
      },
    ],
  };

  it('fuzzy-matches Shovels contact to Comptroller officer', () => {
    const picked = pickOwnerOfficer('SANJAY CHANDRAHAS', entity);
    assert.equal(picked.match, 'match');
    assert.equal(picked.officer?.name, 'SANJAY CHANDRANAS');
  });
});

describe('TexasCpaError', () => {
  it('marks 400 as permanent and 429 as retryable', () => {
    assert.equal(new TexasCpaError('detail', 400, 'Texas CPA detail 400: Bad Request').permanent, true);
    assert.equal(new TexasCpaError('detail', 429, 'Texas CPA detail 429').permanent, false);
    assert.equal(new TexasCpaError('detail', 500, 'Texas CPA detail 500').permanent, false);
  });
});
