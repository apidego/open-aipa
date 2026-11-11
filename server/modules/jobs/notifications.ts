import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Context } from '../../core/context.js';
import { HttpError } from '../../core/http.js';
import { integrationEnabled } from '../../integrations/state.js';
import type { Job, Outcome } from './types.js';
// Explicit dispatch boundary: future providers must implement delivery here.
// A requested external channel must never silently fall back to dashboard.
export function discordLink(ctx: Context, userId: string) {
  if (!integrationEnabled(ctx, 'discord') || !ctx.store.setting('discordBotToken'))
    return undefined;
  return ctx.store.get<{ id: string; discord_user_id: string; channel_id: string }>(
    'SELECT id,discord_user_id,channel_id FROM discord_links WHERE user_id=?',
    userId,
  );
}
export function availableChannels(ctx: Context, userId: string) {
  return discordLink(ctx, userId) ? ['dashboard', 'discord'] : ['dashboard'];
}
export function deliver(ctx: Context, job: Job, runId: string, outcome: Outcome) {
  if (!outcome.notify) return;
  if (!outcome.message.trim()) throw new Error('Empty notification');
  if (job.channel === 'discord' || job.channel === 'dashboard_discord') {
    const target = ctx.store.get<{ link_id: string; channel_id: string }>(
      'SELECT * FROM job_discord_targets WHERE job_id=?',
      job.id,
    );
    const link = discordLink(ctx, job.user_id);
    const valid =
      target && link && target.link_id === link.id && target.channel_id === link.channel_id;
    ctx.store.run(
      'INSERT INTO discord_deliveries(run_id,link_id,channel_id,generation,title,message,status,error,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      runId,
      target?.link_id || '',
      target?.channel_id || '',
      ctx.store.setting('discordGeneration'),
      outcome.title || job.name,
      outcome.message,
      valid ? 'pending' : 'failed',
      valid
        ? null
        : 'Discord-Verknüpfung fehlt oder wurde geändert. Aufgabe pausieren und erneut freigeben.',
      Date.now(),
    );
    if (job.channel === 'discord') return;
  }
  if (job.channel !== 'dashboard' && job.channel !== 'dashboard_discord')
    throw new Error('Delivery channel unavailable');
  ctx.store.run(
    'INSERT INTO notifications(id,user_id,job_id,run_id,title,message,channel,created_at) VALUES(?,?,?,?,?,?,?,?)',
    randomUUID(),
    job.user_id,
    job.id,
    runId,
    outcome.title || job.name,
    outcome.message,
    'dashboard',
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
