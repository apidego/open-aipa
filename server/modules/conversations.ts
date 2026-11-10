import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Context } from '../core/context.js';
import { HttpError } from '../core/http.js';
import type { ChatMessage, RunAgent } from './agent.js';
export function conversationRoutes(ctx: Context, runAgent: RunAgent) {
  const { store } = ctx;
  const router = Router();
  const busy = new Set<string>();
  router.get('/', (req, res) =>
    res.json(
      store.all(
        'SELECT id,title,created_at FROM conversations WHERE user_id=? ORDER BY created_at DESC',
        req.user!.id,
      ),
    ),
  );
  router.post('/', (req, res) => {
    const id = randomUUID();
    store.run(
      'INSERT INTO conversations VALUES(?,?,?,?)',
      id,
      req.user!.id,
      'Neue Konversation',
      Date.now(),
    );
    res.status(201).json({ id });
  });
  router.use('/:id', (req, _res, next) => {
    if (
      !store.get(
        'SELECT id FROM conversations WHERE id=? AND user_id=?',
        String(req.params.id),
        req.user!.id,
      )
    )
      throw new HttpError(404, 'Konversation nicht gefunden.');
    next();
  });
  router.get('/:id', (req, res) =>
    res.json(
      store.all(
        'SELECT id,role,content,created_at FROM messages WHERE conversation_id=? ORDER BY id',
        String(req.params.id),
      ),
    ),
  );
  router.delete('/:id', (req, res) => {
    const id = String(req.params.id);
    if (busy.has(id)) throw new HttpError(409, 'Die Antwort wird noch erstellt.');
    store.run('DELETE FROM conversations WHERE id=?', id);
    res.json({ ok: true });
  });
  router.post('/:id/messages', async (req, res) => {
    const id = String(req.params.id);
    const { content } = z.object({ content: z.string().trim().min(1).max(16000) }).parse(req.body);
    if (busy.has(id)) throw new HttpError(409, 'Die Antwort wird noch erstellt.');
    busy.add(id);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': ping\n\n');
    }, 15000);
    try {
      const history = store.all<ChatMessage>(
        'SELECT role,content FROM (SELECT id,role,content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 60) ORDER BY id',
        id,
      );
      const result = await runAgent(req.user!.id, [...history, { role: 'user', content }], (text) =>
        send('delta', { text }),
      );
      // A completed exchange is atomic; failed requests can safely be retried.
      store.transaction(() => {
        store.run(
          'INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)',
          id,
          'user',
          content,
          Date.now(),
        );
        store.run(
          'INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)',
          id,
          'assistant',
          result,
          Date.now(),
        );
        if (!history.length)
          store.run('UPDATE conversations SET title=? WHERE id=?', content.slice(0, 70), id);
      });
      send('done', { ok: true });
    } catch {
      send('error', {
        error:
          'Antwort fehlgeschlagen. Prüfe API-Key, Modell und Verbindungen. Deine Nachricht wurde nicht gespeichert; bitte erneut senden.',
      });
    } finally {
      clearInterval(heartbeat);
      busy.delete(id);
      res.end();
    }
  });
  return router;
}
