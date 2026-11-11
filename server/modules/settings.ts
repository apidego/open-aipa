import { scenarioModels } from './model-selection.js';
import { Router } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import type { Context } from '../core/context.js';
import { admin, HttpError } from '../core/http.js';
export function settingsRoutes(ctx: Context) {
  const { store, vault } = ctx;
  const router = Router();
  router.use(admin);
  router.get('/', (_req, res) =>
    res.json({
      systemPrompt: store.setting('systemPrompt'),
      model: scenarioModels(ctx).normal,
      complexModel: scenarioModels(ctx).complex,
      taskModel: scenarioModels(ctx).tasks,
      hasApiKey: !!store.setting('apiKey'),
    }),
  );
  router.put('/', (req, res) => {
    const input = z
      .object({
        systemPrompt: z.string().trim().min(1).max(20000),
        model: z.string().trim().min(1).max(100),
        complexModel: z.string().trim().min(1).max(100).optional(),
        taskModel: z.string().trim().min(1).max(100).optional(),
        apiKey: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(req.body);
    store.transaction(() => {
      store.set('systemPrompt', input.systemPrompt);
      store.set('model', input.model);
      if (input.complexModel) store.set('complexModel', input.complexModel);
      if (input.taskModel) store.set('taskModel', input.taskModel);
      if (input.apiKey) store.set('apiKey', vault.seal(input.apiKey));
    });
    res.json({ ok: true });
  });
  router.get('/models', async (_req, res) => {
    if (!store.setting('apiKey'))
      throw new HttpError(400, 'Bitte zuerst den OpenAI API-Key speichern.');
    try {
      const client = new OpenAI({
        apiKey: vault.open(store.setting('apiKey')),
        timeout: 15000,
        maxRetries: 0,
      });
      const ids = new Set<string>();
      for await (const model of client.models.list()) {
        // Model listing has no capability metadata. Exclude known non-text specialties;
        // keep manual IDs available for new or project-specific compatible models.
        if (
          /^(gpt-(4o|4\.1|5|6)|o[134](?:-|$))/.test(model.id) &&
          !/(audio|image|realtime|transcribe|tts|search|deep-research|computer-use|codex)/i.test(
            model.id,
          )
        )
          ids.add(model.id);
      }
      for (const id of Object.values(scenarioModels(ctx))) if (id) ids.add(id);
      res.json({
        models: [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      });
    } catch {
      throw new HttpError(
        502,
        'Modellliste konnte nicht geladen werden. API-Key und OpenAI-Zugriff prüfen.',
      );
    }
  });
  router.post('/test', async (_req, res) => {
    try {
      const client = new OpenAI({
        apiKey: vault.open(store.setting('apiKey')),
        timeout: 15000,
        maxRetries: 0,
      });
      await Promise.all(
        [...new Set(Object.values(scenarioModels(ctx)))].map((model) =>
          client.models.retrieve(model),
        ),
      );
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
