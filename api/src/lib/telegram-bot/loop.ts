/**
 * DL-402 — Anthropic tool-use main loop.
 *
 * Pure orchestration. This file imports ONLY domain types + the four
 * interfaces (`BotMessenger`, `ChatHistoryStore`, `LlmClient`, `ToolRegistry`).
 * It MUST NOT import:
 *   - Cloudflare runtime types
 *   - fetch-using adapters (Telegram client, Worker API client, KV)
 *   - The activity logger (the route owns telemetry)
 *
 * That isolation is what makes this file unit-testable without a Worker.
 */

import type {
  AnthropicCompletion,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicToolUseBlock,
  BotMessenger,
  ChatHistoryStore,
  LlmClient,
  ToolContext,
} from './types';
import type { ToolRegistry } from './tools';

export interface LoopDeps {
  llm: LlmClient;
  messenger: BotMessenger;
  history: ChatHistoryStore;
  tools: ToolRegistry;
  systemPrompt: string;
}

export interface LoopInput {
  chatId: number;
  text: string;
  ctx: ToolContext;
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * Run one user-turn:
 *   1. Append user message to history.
 *   2. Loop: call LLM → if tool_use, execute tools (read-only in M1),
 *      append tool_result, repeat. Stop on end_turn or max iterations.
 *   3. Send final assistant text via Telegram.
 *   4. Persist trimmed history.
 *
 * Returns nothing — side effects are sendMessage + history.write.
 */
export async function runChatTurn(deps: LoopDeps, input: LoopInput): Promise<void> {
  await deps.messenger.sendChatAction({ chatId: input.chatId, action: 'typing' });

  const history = await deps.history.read(input.chatId);
  history.push({ role: 'user', content: input.text });

  const toolSchemas = deps.tools.toAnthropicSchemas();
  let assistantText = '';

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion: AnthropicCompletion = await deps.llm.complete({
      system: deps.systemPrompt,
      messages: history,
      tools: toolSchemas,
    });

    history.push({ role: 'assistant', content: completion.content });

    if (completion.stop_reason !== 'tool_use') {
      assistantText = extractText(completion.content);
      break;
    }

    const toolUses = completion.content.filter(
      (b): b is AnthropicToolUseBlock => b.type === 'tool_use'
    );
    if (toolUses.length === 0) {
      assistantText = extractText(completion.content);
      break;
    }

    const toolResultBlocks: AnthropicContentBlock[] = [];
    for (const use of toolUses) {
      const tool = deps.tools.get(use.name);
      if (!tool) {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `error: unknown_tool ${use.name}`,
          is_error: true,
        });
        continue;
      }
      try {
        const result = await tool.execute(use.input, input.ctx);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: result.content,
          is_error: result.isError ?? false,
        });
      } catch (err) {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }

    history.push({ role: 'user', content: toolResultBlocks });
  }

  if (!assistantText) {
    assistantText = '(no reply)';
  }

  await deps.messenger.sendMessage({
    chatId: input.chatId,
    text: assistantText,
    parseMode: 'HTML',
  });

  await deps.history.write(input.chatId, history);
}

function extractText(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
