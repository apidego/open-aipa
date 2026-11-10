import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Context } from '../core/context.js';
import type { RunAgent } from './agent.js';
import { HttpError } from '../core/http.js';
interface Automation {
  id: string;
  user_id: string;
  prompt: string;
  interval_minutes: number;
}
export function automationRoutes(ctx: Context) {
  const { store } = ctx;
  const router = Router();
  router.get('/', (req, res) =>
    res.json(
      store.all('SELECT * FROM automations WHERE user_id=? ORDER BY next_run', req.user!.id),
    ),
  );
  router.post('/', (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(100),
        prompt: z.string().trim().min(1).max(16000),
        intervalMinutes: z.number().int().min(15).max(43200),
      })
      .parse(req.body);
    const count = store.get<{ count: number }>(
      'SELECT COUNT(*) count FROM automations WHERE user_id=?',
      req.user!.id,
    )!.count;
    if (count >= 20) throw new HttpError(400, 'Maximal 20 Automatisierungen pro Nutzer.');
    const id = randomUUID();
    store.run(
      'INSERT INTO automations VALUES(?,?,?,?,?,?,1)',
      id,
      req.user!.id,
      data.name,
      data.prompt,
      data.intervalMinutes,
      Date.now() + data.intervalMinutes * 60000,
    );
    res.status(201).json({ id });
  });
  router.use('/:id', (req, _res, next) => {
    if (
      !store.get(
        'SELECT id FROM automations WHERE id=? AND user_id=?',
        String(req.params.id),
        req.user!.id,
      )
    )
      throw new HttpError(404, 'Automatisierung nicht gefunden.');
    next();
  });
  router.get('/:id/runs', (req, res) =>
    res.json(
      store.all(
        'SELECT * FROM runs WHERE automation_id=? ORDER BY created_at DESC LIMIT 20',
        String(req.params.id),
      ),
    ),
  );
  router.patch('/:id', (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    store.run(
      'UPDATE automations SET enabled=?, next_run=? + interval_minutes * 60000 WHERE id=?',
      Number(enabled),
      Date.now(),
      String(req.params.id),
    );
    res.json({ ok: true });
  });
  router.delete('/:id', (req, res) => {
    store.run('DELETE FROM automations WHERE id=?', String(req.params.id));
    res.json({ ok: true });
  });
  return router;
}
export function scheduler(ctx: Context, runAgent: RunAgent) {
  const { store } = ctx;
  let running = false;
  // Single-process worker. Interrupted runs are explicit, never silently replayed.
  store.run(
    "UPDATE runs SET status='failed', result='Server restart interrupted this run.' WHERE status='running'",
  );
  return async () => {
    if (running || !store.setting('initialized')) return;
    running = true;
    try {
      const due = store.all<Automation>(
        'SELECT * FROM automations WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 5',
        Date.now(),
      );
      for (const job of due) {
        const id = randomUUID();
        const claimed = store.transaction(() => {
          const changed = store.run(
            'UPDATE automations SET next_run=? WHERE id=? AND enabled=1 AND next_run<=?',
            Date.now() + job.interval_minutes * 60000,
            job.id,
            Date.now(),
          ).changes;
          if (changed)
            store.run(
              'INSERT INTO runs VALUES(?,?,?,?,?)',
              id,
              job.id,
              'running',
              null,
              Date.now(),
            );
          return changed;
        });
        if (!claimed) continue;
        try {
          const result = await runAgent(job.user_id, [{ role: 'user', content: job.prompt }]);
          store.run("UPDATE runs SET status='completed', result=? WHERE id=?", result, id);
        } catch {
          store.run(
            "UPDATE runs SET status='failed', result='Ausführung fehlgeschlagen. API-Key, Modell und Integrationen prüfen.' WHERE id=?",
            id,
          );
        }
      }
    } finally {
      running = false;
    }
  };
}
