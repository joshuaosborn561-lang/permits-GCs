import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvRowsToLeads } from '../services/importCallingList.js';

describe('csvRowsToLeads', () => {
  it('maps Shovels-style headers into calling-list leads', () => {
    const csv = [
      'business_name,contact_name,phone,email,city,state,zip',
      'Acme Plumbing,Tom Plumber,2145550100,tom@acme.com,Houston,TX,77002',
      '',
      'Other LLC,Jane Owner,7135550199,,Katy,TX,77494',
    ].join('\n');
    const { leads, skipped_empty, truncated } = csvRowsToLeads(csv);
    assert.equal(truncated, false);
    assert.equal(skipped_empty, 1);
    assert.equal(leads.length, 2);
    assert.equal(leads[0]?.name, 'Acme Plumbing');
    assert.equal(leads[0]?.owner_name, 'Tom Plumber');
    assert.equal(leads[0]?.city, 'Houston');
    assert.equal(leads[0]?.phone, '2145550100');
    assert.equal(leads[1]?.name, 'Other LLC');
  });

  it('rejects a CSV with no company or contact column', () => {
    assert.throws(() => csvRowsToLeads('foo,bar\n1,2\n'), /company or contact/);
  });
});
