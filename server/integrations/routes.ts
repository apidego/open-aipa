import { gmailAccess } from '../modules/mail/actions.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Context } from '../core/context.js';
import { admin, HttpError } from '../core/http.js';
import { integrations } from './registry.js';
import { enabledKey, integrationEnabled } from './state.js';
// One-time initialization preserves pre-existing installations, never re-enables a disabled provider.
export function initializeIntegrations(ctx: Context) {
  ctx.store.transaction(() => {
    for (const provider of integrations) {
      if (ctx.store.setting(enabledKey(provider.id))) continue;
      const existing =
        provider.configured(ctx) ||
        !!ctx.store.get('SELECT 1 FROM connections WHERE provider=?', provider.id);
      ctx.store.set(enabledKey(provider.id), String(existing));
    }
  });
}
export function integrationRoutes(ctx: Context) {
  const router = Router();
  router.get('/', (req, res) =>
    res.json(
      integrations.map((i) => ({
        id: i.id,
        ...(i.id === 'gmail' ? { canWrite: gmailAccess(ctx, req.user!.id).canWrite } : {}),
        name: i.name,
        description: i.description,
        enabled: integrationEnabled(ctx, i.id),
        configured: i.configured(ctx),
        connected: !!ctx.store.get(
          'SELECT 1 FROM connections WHERE user_id=? AND provider=?',
          req.user!.id,
          i.id,
        ),
      })),
    ),
  );
  router.put('/:id/activation', admin, (req, res) => {
    const provider = integrations.find((i) => i.id === req.params.id);
    if (!provider) throw new HttpError(404, 'Integration nicht gefunden.');
    const input = z
      .discriminatedUnion('enabled', [
        z.object({ enabled: z.literal(true) }).strict(),
        z.object({ enabled: z.literal(false), keepConfiguration: z.boolean() }).strict(),
      ])
      .parse(req.body);
    ctx.store.transaction(() => {
      ctx.store.set(enabledKey(provider.id), String(input.enabled));
      if (!input.enabled) {
        provider.deactivate?.(ctx);
        if (!input.keepConfiguration) {
          provider.clearConfiguration(ctx);
          ctx.store.run('DELETE FROM connections WHERE provider=?', provider.id);
        }
      }
    });
    res.json({ ok: true });
  });
  return router;
}
