import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// DL-423 tripwire: structural assertions against archive-expander.ts source.
// The real WASM extractor is awkward to load under `node --test`, so instead
// of running it we grep the source for the invariants that must hold:
//
//   - Extract success path pushes only synthetic children (result.attachments.push(synth)).
//   - Each failure path (oversize / extract throw / zero entries) pushes the
//     raw parent (result.attachments.push(att)).
//   - The invariant comment marker is present so future maintainers see it.
//
// If anyone reshapes the function and breaks one of these, this test fires
// before the change lands in production.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_PATH = resolve(__dirname, '../src/lib/inbound/archive-expander.ts');
const src = readFileSync(SRC_PATH, 'utf8');

function sliceBetween(haystack, startMarker, endMarker) {
  const start = haystack.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected to find marker "${startMarker}" in source`);
  const end = haystack.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Expected to find end marker "${endMarker}" after "${startMarker}"`);
  return haystack.slice(start, end);
}

test('invariant comment is present', () => {
  assert.match(src, /INVARIANT \(DL-423\)/);
});

test('extract-success branch pushes synthetic children, NOT the parent', () => {
  // The success branch starts at `Build AttachmentInfo for each extracted file`
  // and ends at the closing of the outer `for (const att of pending)` loop
  // (just before `pending = nextRound;`).
  const successBranch = sliceBetween(
    src,
    'Build AttachmentInfo for each extracted file',
    'pending = nextRound;',
  );
  assert.match(
    successBranch,
    /result\.attachments\.push\(synth\)/,
    'success branch must push the synthetic child',
  );
  assert.doesNotMatch(
    successBranch,
    /result\.attachments\.push\(att\)/,
    'success branch must NOT push the parent archive — that would put the ZIP alongside its children in AI Review',
  );
});

test('oversize-archive branch pushes raw parent as fallback', () => {
  const oversizeBranch = sliceBetween(
    src,
    "action: 'skipped_too_heavy'",
    'continue;',
  );
  assert.match(
    oversizeBranch,
    /result\.attachments\.push\(att\)/,
    'skipped_too_heavy branch must push the raw parent so it lands as a fallback PC',
  );
});

test('extract-failure branch pushes raw parent as fallback', () => {
  const failBranch = sliceBetween(
    src,
    "action: 'extract_failed'",
    'continue;',
  );
  assert.match(
    failBranch,
    /result\.attachments\.push\(att\)/,
    'extract_failed branch must push the raw parent so it lands as a fallback PC',
  );
});

test('empty-archive branch pushes raw parent as fallback', () => {
  const emptyBranch = sliceBetween(
    src,
    'No extractable files in',
    'continue;',
  );
  assert.match(
    emptyBranch,
    /result\.attachments\.push\(att\)/,
    'zero-entries branch must push the raw parent so it lands as a fallback PC',
  );
});
