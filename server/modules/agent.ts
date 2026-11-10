import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { Context } from '../core/context.js';
import { HttpError } from '../core/http.js';
import { connectedIntegrations } from '../integrations/registry.js';
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type RunAgent = (
  userId: string,
  messages: ChatMessage[],
  delta?: (text: string) => void,
) => Promise<string>;
export function agentRunner(ctx: Context): RunAgent {
  return async (userId, messages, delta) => {
    const encrypted = ctx.store.setting('apiKey');
    if (!encrypted) throw new HttpError(400, 'Bitte einen OpenAI API-Key konfigurieren.');
    const client = new OpenAI({
      apiKey: ctx.vault.open(encrypted),
      timeout: 90_000,
      maxRetries: 1,
    });
    const available = connectedIntegrations(ctx, userId);
    const input: ResponseInput = [...messages];
    for (let round = 0; round < 5; round++) {
      const stream = await client.responses.create({
        model: ctx.store.setting('model'),
        instructions: ctx.store.setting('systemPrompt'),
        input,
        tools: available.flatMap((i) => i.tools),
        store: false,
        include: ['reasoning.encrypted_content'],
        stream: true,
        max_output_tokens: 4096,
      });
      let final: OpenAI.Responses.Response | undefined;
      let output = '';
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          output += event.delta;
          delta?.(event.delta);
        }
        if (event.type === 'response.completed') final = event.response;
        if (
          event.type === 'response.failed' ||
          event.type === 'error' ||
          event.type === 'response.incomplete'
        )
          throw new Error('OpenAI response incomplete');
      }
      if (!final) throw new Error('No complete response');
      const calls = final.output.filter((item) => item.type === 'function_call');
      if (!calls.length) {
        if (!output) throw new Error('Empty response');
        return output;
      }
      input.push(
        ...final.output.filter(
          (item) =>
            item.type === 'message' || item.type === 'function_call' || item.type === 'reasoning',
        ),
      );
      for (const call of calls) {
        const provider = available.find((i) => i.tools.some((t) => t.name === call.name));
        let result: unknown = { error: 'Tool unavailable' };
        if (provider) {
          try {
            result = await provider.execute(ctx, userId, call.name, JSON.parse(call.arguments));
          } catch {
            result = { error: 'Integration request failed. Reconnect or check access.' };
          }
        }
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
    }
    throw new HttpError(502, 'Das Werkzeuglimit wurde erreicht. Bitte grenze den Auftrag ein.');
  };
}
