import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Context } from '../../core/context.js';
import { HttpError } from '../../core/http.js';
import type { Job, Outcome } from './types.js';
// Explicit dispatch boundary: future providers must implement delivery here.
// A requested external channel must never silently fall back to dashboard.
export const notificationChannels = ['dashboard'] as const;
export function deliver(ctx: Context, job: Job, runId: string, outcome: Outcome) {
  if (!outcome.notify) return;
  if (job.channel !== 'dashboard') throw new Error('Delivery channel unavailable');
  if (!outcome.message.trim()) throw new Error('Empty notification');
  ctx.store.run(
    'INSERT INTO notifications(id,user_id,job_id,run_id,title,message,channel,created_at) VALUES(?,?,?,?,?,?,?,?)',
    randomUUID(),
    job.user_id,
    job.id,
    runId,
    outcome.title || job.name,
    outcome.message,
    job.channel,
    Date.now(),
  );
}
export function notificationRoutes(ctx: Context) {
  const router = Router();
  router.get('/', (req, res) =>
    res.json({
      items: ctx.store.all(
        'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
        req.user!.id,
      ),
      unread: ctx.store.get<{ n: number }>(
        'SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL',
        req.user!.id,
      )!.n,
    }),
  );
  router.patch('/:id/read', (req, res) => {
    const result = ctx.store.run(
      'UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?',
      Date.now(),
      String(req.params.id),
      req.user!.id,
    );
    if (!result.changes) throw new HttpError(404, 'Benachrichtigung nicht gefunden.');
    res.json({ ok: true });
  });
  return router;
}
