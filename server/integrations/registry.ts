import type { Context } from '../core/context.js';
import type { Integration } from './types.js';
import { integrationEnabled } from './state.js';
import { gmail } from './gmail.js';
export const integrations: Integration[] = [gmail];
export function connectedIntegrations(ctx: Context, userId: string) {
  const connected = ctx.store.all<{ provider: string }>(
    'SELECT provider FROM connections WHERE user_id=?',
    userId,
  );
  return integrations.filter(
    (i) => integrationEnabled(ctx, i.id) && connected.some((c) => c.provider === i.id),
  );
}
