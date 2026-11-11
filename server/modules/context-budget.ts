import { createHash } from 'node:crypto';
import { getEncoding } from 'js-tiktoken';
import type { Context } from '../core/context.js';
import { HttpError } from '../core/http.js';
const encodings = [getEncoding('o200k_base'), getEncoding('cl100k_base')];
export const MAX_RECENT_MESSAGES = 80;
export const SUMMARY_TOKENS = 2000;
export const OUTPUT_TOKENS = 4096;
export const TOOL_RESERVE = 8192;
// Local estimate, not an exact provider count. Use the larger encoding plus framing headroom.
const counts = new Map<string, number>();
const chunkCounts = new Map<string, number>();
export function textTokens(text: string): number {
  const key = createHash('sha256').update(text).digest('hex');
  const cached = counts.get(key);
  if (cached !== undefined) return cached;
  // Chunking prevents pathological BPE runtime on long repeated strings. Boundaries and a
  // safety margin make this a conservative local estimate, not the provider's exact count.
  let count = 0;
  for (let offset = 0; offset < text.length; offset += 128) {
    const chunk = text.slice(offset, offset + 128);
    const chunkKey = createHash('sha256').update(chunk).digest('hex');
    let size = chunkCounts.get(chunkKey);
    if (size === undefined) {
      size = Math.max(...encodings.map((e) => e.encode(chunk, [], []).length)) + 1;
      if (chunkCounts.size >= 512) chunkCounts.delete(chunkCounts.keys().next().value!);
      chunkCounts.set(chunkKey, size);
    }
    count += size;
  }
  const result = Math.ceil(count * 1.05);
  if (counts.size >= 512) counts.delete(counts.keys().next().value!);
  counts.set(key, result);
  return result;
}
export function requestTokens(instructions: string, input: unknown, tools: unknown = []): number {
  return textTokens(JSON.stringify({ instructions, input, tools })) + 512;
}
export function inputBudget(ctx: Context) {
  return ctx.config.chatContextTokens ?? 32768;
}
export function assertRequestBudget(
  ctx: Context,
  instructions: string,
  input: unknown,
  tools: unknown = [],
) {
  if (requestTokens(instructions, input, tools) > inputBudget(ctx))
    throw new HttpError(
      400,
      'Das Kontextbudget ist erreicht. Bitte den Auftrag eingrenzen oder eine neue Konversation beginnen.',
    );
}
export function clipText(text: string, budget: number) {
  if (textTokens(text) <= budget) return text;
  // Keep both the beginning and the end; explicitly label omitted middle text.
  const marker = '\n[… wegen Länge gekürzt …]\n';
  let low = 0,
    high = Math.min(text.length, 100000),
    result = marker;
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const half = Math.floor(length / 2);
    const candidate = text.slice(0, half) + marker + text.slice(text.length - (length - half));
    if (textTokens(candidate) <= budget) {
      result = candidate;
      low = length + 1;
    } else high = length - 1;
  }
  return result;
}
export function boundedToolResult(value: unknown) {
  const serialized = JSON.stringify(value) ?? 'null';
  if (textTokens(serialized) <= 6000) return serialized;
  return JSON.stringify({
    truncated: true,
    warning:
      'Incomplete tool data. Do not infer that omitted information is absent; narrow the query if needed.',
    excerpt: clipText(serialized, 5000),
  });
}
