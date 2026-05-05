/**
 * DL-402 KV-backed ChatHistoryStore.
 *
 * Trim policy: keep at most HISTORY_TURN_CAP "turns", where a turn = one
 * user message + the assistant's full response (including any tool_use /
 * tool_result chain). We approximate by keeping the last N user messages
 * plus everything between them, which preserves the tool_use → tool_result
 * pairing Anthropic requires.
 */

import type { AnthropicMessage, ChatHistoryStore } from './types';
import { HISTORY_TURN_CAP, KV_KEYS, TTL_SECONDS } from './types';

export class KvChatHistoryStore implements ChatHistoryStore {
  constructor(private readonly kv: KVNamespace) {}

  async read(chatId: number): Promise<AnthropicMessage[]> {
    const raw = await this.kv.get(KV_KEYS.history(chatId), 'json');
    if (!raw || !Array.isArray(raw)) return [];
    return raw as AnthropicMessage[];
  }

  async write(chatId: number, messages: AnthropicMessage[]): Promise<void> {
    const trimmed = trimToTurnCap(messages, HISTORY_TURN_CAP);
    await this.kv.put(KV_KEYS.history(chatId), JSON.stringify(trimmed), {
      expirationTtl: TTL_SECONDS.history,
    });
  }

  async clear(chatId: number): Promise<void> {
    await this.kv.delete(KV_KEYS.history(chatId));
  }
}

/**
 * Pure: drop oldest turns until at most `cap` user messages remain. Always
 * starts the window at a user message so the first turn is well-formed for
 * Anthropic (which rejects an assistant-leading conversation).
 */
export function trimToTurnCap(
  messages: AnthropicMessage[],
  cap: number
): AnthropicMessage[] {
  if (cap <= 0) return [];
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' && !isToolResultOnly(messages[i])) {
      userIndices.push(i);
    }
  }
  if (userIndices.length <= cap) return messages;
  const startAt = userIndices[userIndices.length - cap];
  return messages.slice(startAt);
}

/**
 * A user message that contains only tool_result blocks is the second half
 * of a tool-use round-trip, not a fresh turn. Don't count it toward the cap.
 */
function isToolResultOnly(m: AnthropicMessage): boolean {
  if (typeof m.content === 'string') return false;
  return m.content.length > 0 && m.content.every((b) => b.type === 'tool_result');
}
