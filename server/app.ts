import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './core/config.js';
import { Store } from './core/db.js';
import { Vault, digest } from './core/security.js';
import { authenticated, HttpError, type User } from './core/http.js';
import { authRoutes } from './modules/auth.js';
import { botProfileRoutes } from './modules/bot-profile.js';
import { settingsRoutes } from './modules/settings.js';
import { agentRunner, type RunAgent } from './modules/agent.js';
import { conversationContext, type Summarize } from './modules/conversation-context.js';
import { conversationRoutes } from './modules/conversations.js';
import { scheduler } from './modules/jobs/scheduler.js';
import { jobRoutes } from './modules/jobs/routes.js';
import { jobPlanner } from './modules/jobs/planner.js';
import { notificationRoutes } from './modules/jobs/notifications.js';
import type { PlanJob } from './modules/jobs/types.js';
import { discordRoutes } from './integrations/discord.js';
import { discordRuntime } from './integrations/discord-runtime.js';
import { gmailRoutes } from './integrations/gmail.js';
import { connectedIntegrations } from './integrations/registry.js';
import { integrationRoutes, initializeIntegrations } from './integrations/routes.js';
export function createApp(
  config: Config,
  overrideAgent?: RunAgent,
  overridePlanner?: PlanJob,
  overrideSummary?: Summarize,
) {
  const store = new Store(config.dataDir);
  const ctx = { store, config, vault: new Vault(config.encryptionKey) };
  initializeIntegrations(ctx);
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'upgrade-insecure-requests': config.url.startsWith('https:') ? [] : null,
        },
      },
      strictTransportSecurity: config.url.startsWith('https:') ? undefined : false,
    }),
  );
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Zu viele Anfragen. Bitte kurz warten.' },
    }),
  );
  app.use('/api/bot-profile', express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '64kb' }), cookieParser());
  app.use('/api', (req, _res, next) => {
    // Enforce exact origin for all writes, including login and setup. No wildcard CORS.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.url)
      throw new HttpError(403, 'Anfrage von nicht erlaubter Herkunft.');
    const raw = req.cookies.pa_session;
    if (typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw)) {
      const hashed = digest(raw);
      req.user = store.get<User>(
        'SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?',
        hashed,
        Date.now(),
      );
      if (req.user) req.sessionToken = hashed;
    }
    next();
  });
  app.use('/api', authRoutes(ctx));
  app.use('/api', authenticated);
  app.use('/api/settings', settingsRoutes(ctx));
  app.use('/api/bot-profile', botProfileRoutes(ctx));
  const runAgent = overrideAgent || agentRunner(ctx);
  const prepare = conversationContext(ctx, overrideSummary);
  const discord = discordRuntime(ctx, runAgent, undefined, prepare);
  app.use('/api/conversations', conversationRoutes(ctx, runAgent, prepare));
  const planJob = overridePlanner || jobPlanner(ctx);
  app.use('/api/automations', jobRoutes(ctx, 'automation', planJob));
  app.use('/api/tasks', jobRoutes(ctx, 'task', planJob));
  app.use('/api/notifications', notificationRoutes(ctx));
  app.use('/api/integrations', integrationRoutes(ctx));
  app.use('/api/integrations/gmail', gmailRoutes(ctx));
  app.use('/api/integrations/discord', discordRoutes(ctx, discord.status));
  app.get('/api/dashboard', (req, res) => {
    const count = (table: string) =>
      store.get<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`, req.user!.id)!.n;
    res.json({
      conversations: count('conversations'),
      integrations: connectedIntegrations(ctx, req.user!.id).length,
      automations: store.get<{ n: number }>(
        "SELECT COUNT(*) n FROM jobs WHERE user_id=? AND kind='automation'",
        req.user!.id,
      )!.n,
      tasks: store.get<{ n: number }>(
        "SELECT COUNT(*) n FROM jobs WHERE user_id=? AND kind='task'",
        req.user!.id,
      )!.n,
      model: store.setting('model'),
      recent: store.all(
        'SELECT id,title,created_at FROM conversations WHERE user_id=? ORDER BY created_at DESC LIMIT 5',
        req.user!.id,
      ),
      runs: store.all(
        'SELECT r.id,r.status,r.created_at,a.name,a.id job_id,a.kind FROM job_runs r JOIN jobs a ON a.id=r.job_id WHERE a.user_id=? ORDER BY r.created_at DESC LIMIT 5',
        req.user!.id,
      ),
    });
  });
  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'Nicht gefunden.');
  });
  app.use(express.static(resolve('dist/web')));
  app.use('/assets', (_req, res) => {
    res.status(404).end();
  });
  app.get('/{*path}', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(resolve('dist/web/index.html'));
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Bitte Eingaben prüfen.',
        fields: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      res.status(400).json({ error: 'Ungültiger Anfrageinhalt.' });
      return;
    }
    console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'Ein interner Fehler ist aufgetreten.' });
  };
  app.use(errors);
  return { app, ctx, discord, tick: scheduler(ctx, runAgent) };
}
