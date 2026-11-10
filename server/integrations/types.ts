import type { FunctionTool } from 'openai/resources/responses/responses';
import type { Context } from '../core/context.js';
export interface Integration {
  id: string;
  name: string;
  description: string;
  configured(ctx: Context): boolean;
  clearConfiguration(ctx: Context): void;
  deactivate?(ctx: Context): void;
  tools: FunctionTool[];
  // Explicit read-only capabilities exposed to generated scripts.
  scriptTools?: readonly string[];
  execute(ctx: Context, userId: string, name: string, args: unknown): Promise<unknown>;
}
