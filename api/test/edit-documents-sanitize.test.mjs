import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBatchUpdates, AIRTABLE_REC_ID } from '../src/lib/batch-sanitize.mjs';

const GOOD_ID = 'rec1234567890abcd';
const GOOD_ID_2 = 'recABCDEFGHIJKLMN';

test('AIRTABLE_REC_ID regex matches rec + 14 base62', () => {
  assert.ok(AIRTABLE_REC_ID.test(GOOD_ID));
  assert.ok(!AIRTABLE_REC_ID.test('rec123'));
  assert.ok(!AIRTABLE_REC_ID.test('rec1234567890abc!'));
  assert.ok(!AIRTABLE_REC_ID.test(''));
});

test('drops record with empty id', () => {
  const { valid, dropped } = sanitizeBatchUpdates([
    { id: '', fields: { status: 'Waived' } },
  ]);
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'invalid_id');
});

test('drops record with non-recXXX id (Tally option UUID)', () => {
  const { valid, dropped } = sanitizeBatchUpdates([
    { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', fields: { status: 'Waived' } },
  ]);
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'invalid_id');
});

test('drops record whose fields are all undefined (empty after strip)', () => {
  const { valid, dropped } = sanitizeBatchUpdates([
    { id: GOOD_ID, fields: { status: undefined } },
  ]);
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'empty_fields');
  assert.equal(dropped[0].id, GOOD_ID);
});

test('keeps well-formed record untouched', () => {
  const { valid, dropped } = sanitizeBatchUpdates([
    { id: GOOD_ID, fields: { status: 'Waived', bookkeepers_notes: 'n' } },
  ]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
  assert.deepEqual(valid[0], { id: GOOD_ID, fields: { status: 'Waived', bookkeepers_notes: 'n' } });
});

test('mixed batch: valid survive, invalid dropped, undefined stripped', () => {
  const { valid, dropped } = sanitizeBatchUpdates([
    { id: GOOD_ID, fields: { status: 'Waived', note: undefined } },
    { id: '', fields: { status: 'Waived' } },
    { id: GOOD_ID_2, fields: { status: undefined } },
    { id: GOOD_ID_2, fields: { issuer_name: 'Foo' } },
  ]);
  assert.equal(valid.length, 2);
  assert.deepEqual(valid[0], { id: GOOD_ID, fields: { status: 'Waived' } });
  assert.deepEqual(valid[1], { id: GOOD_ID_2, fields: { issuer_name: 'Foo' } });
  assert.equal(dropped.length, 2);
  assert.equal(dropped[0].reason, 'invalid_id');
  assert.equal(dropped[1].reason, 'empty_fields');
});

test('tolerates null / non-object entries', () => {
  const { valid, dropped } = sanitizeBatchUpdates([
    null,
    { id: GOOD_ID, fields: null },
    { id: GOOD_ID, fields: { status: 'Waived' } },
  ]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 2);
});
