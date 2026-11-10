import type { FunctionTool } from 'openai/resources/responses/responses';
import type { Context } from '../core/context.js';
export interface Integration {
  id: string;
  name: string;
  description: string;
  tools: FunctionTool[];
  // Explicit read-only capabilities exposed to generated scripts.
  scriptTools?: readonly string[];
  execute(ctx: Context, userId: string, name: string, args: unknown): Promise<unknown>;
}
