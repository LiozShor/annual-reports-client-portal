/**
 * DL-402 LlmClient adapter — raw fetch against Anthropic Messages API.
 *
 * Mirrors the `chat.ts` Phase 9 pattern: x-api-key header, anthropic-version
 * 2023-06-01. No SDK dependency — the surface we need is small and stable.
 */

import { CLAUDE_MODEL } from './types';
import type {
  AnthropicCompletion,
  AnthropicMessage,
  AnthropicToolSchema,
  LlmClient,
} from './types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = CLAUDE_MODEL
  ) {}

  async complete(args: {
    system: string;
    messages: AnthropicMessage[];
    tools: AnthropicToolSchema[];
    maxTokens?: number;
  }): Promise<AnthropicCompletion> {
    const body = {
      model: this.model,
      max_tokens: args.maxTokens ?? 1024,
      system: args.system,
      messages: args.messages,
      tools: args.tools,
    };

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`anthropic_${response.status}: ${text.slice(0, 200)}`);
    }

    const json = (await response.json()) as AnthropicCompletion;
    return json;
  }
}
