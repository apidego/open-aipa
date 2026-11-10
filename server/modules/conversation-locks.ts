import type { Context } from '../core/context.js';
const locks = new WeakMap<Context['store'], Set<string>>();
export function conversationLocks(ctx: Context) {
  let busy = locks.get(ctx.store);
  if (!busy) {
    busy = new Set<string>();
    locks.set(ctx.store, busy);
  }
  return busy;
}
