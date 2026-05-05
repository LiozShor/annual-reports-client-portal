/**
 * DL-402 — contract test for telegram-bot/history.ts trimToTurnCap().
 *
 * The TS source is in src/lib/telegram-bot/history.ts. node --test cannot
 * import .ts directly; instead we lock the algorithm contract here. If the
 * TS implementation drifts, this test must be updated in lockstep.
 *
 * Reference algorithm (mirrors history.ts):
 *   - Count user messages that are NOT "tool_result-only" as "turns".
 *   - If turns <= cap, return messages unchanged.
 *   - Else slice from the (turns - cap)th such user message onward.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

function isToolResultOnly(m) {
  if (typeof m.content === 'string') return false;
  return m.content.length > 0 && m.content.every((b) => b.type === 'tool_result');
}

function trimToTurnCap(messages, cap) {
  if (cap <= 0) return [];
  const userIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' && !isToolResultOnly(messages[i])) {
      userIndices.push(i);
    }
  }
  if (userIndices.length <= cap) return messages;
  const startAt = userIndices[userIndices.length - cap];
  return messages.slice(startAt);
}

test('returns input untouched when turns <= cap', () => {
  const msgs = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'b' },
    { role: 'assistant', content: 'B' },
  ];
  assert.deepEqual(trimToTurnCap(msgs, 10), msgs);
});

test('trims oldest turns when over cap', () => {
  const msgs = [
    { role: 'user', content: 'old1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'old2' },
    { role: 'assistant', content: 'A2' },
    { role: 'user', content: 'keep' },
    { role: 'assistant', content: 'K' },
  ];
  const out = trimToTurnCap(msgs, 1);
  assert.equal(out.length, 2);
  assert.equal(out[0].content, 'keep');
});

test('does NOT count tool_result-only user messages as turns', () => {
  const msgs = [
    { role: 'user', content: 'q1' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }],
    },
    { role: 'assistant', content: 'final' },
  ];
  assert.deepEqual(trimToTurnCap(msgs, 1), msgs, 'one real turn → unchanged');
});

test('preserves tool_use → tool_result pairing across the trim boundary', () => {
  const msgs = [
    { role: 'user', content: 'old turn' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'kept turn' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't9', name: 'q', input: {} }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't9', content: 'r' }],
    },
    { role: 'assistant', content: 'final' },
  ];
  const out = trimToTurnCap(msgs, 1);
  assert.equal(out.length, 4);
  assert.equal(out[0].content, 'kept turn');
  assert.equal(out[3].content, 'final');
});

test('cap = 0 returns empty array', () => {
  assert.deepEqual(trimToTurnCap([{ role: 'user', content: 'x' }], 0), []);
});

test('empty input returns empty array', () => {
  assert.deepEqual(trimToTurnCap([], 5), []);
});
