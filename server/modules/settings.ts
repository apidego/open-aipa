import { Router } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import type { Context } from '../core/context.js';
import { admin, HttpError } from '../core/http.js';
export function settingsRoutes(ctx: Context) {
  const { store, vault, config } = ctx;
  const router = Router();
  router.use(admin);
  router.get('/', (_req, res) =>
    res.json({
      systemPrompt: store.setting('systemPrompt'),
      model: store.setting('model'),
      hasApiKey: !!store.setting('apiKey'),
      googleClientId: store.setting('googleClientId') || config.googleClientId,
      hasGoogleSecret: !!(store.setting('googleClientSecret') || config.googleClientSecret),
      callbackUrl: `${config.url}/api/integrations/gmail/callback`,
    }),
  );
  router.put('/', (req, res) => {
    const input = z
      .object({
        systemPrompt: z.string().trim().min(1).max(20000),
        model: z.string().trim().min(1).max(100),
        apiKey: z.string().trim().max(500).optional(),
        googleClientId: z.string().trim().max(500).optional(),
        googleClientSecret: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    store.transaction(() => {
      store.set('systemPrompt', input.systemPrompt);
      store.set('model', input.model);
      if (input.apiKey) store.set('apiKey', vault.seal(input.apiKey));
      if (input.googleClientId !== undefined) store.set('googleClientId', input.googleClientId);
      if (input.googleClientSecret)
        store.set('googleClientSecret', vault.seal(input.googleClientSecret));
    });
    res.json({ ok: true });
  });
  router.post('/test', async (_req, res) => {
    try {
      const client = new OpenAI({
        apiKey: vault.open(store.setting('apiKey')),
        timeout: 15000,
        maxRetries: 0,
      });
      await client.models.retrieve(store.setting('model'));
      res.json({ ok: true });
    } catch {
      throw new HttpError(
        400,
        'API-Key oder Modell nicht verfügbar. Prüfe die OpenAI-Projekteinstellungen.',
      );
    }
  });
  return router;
}
