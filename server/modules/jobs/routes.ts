import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Context } from '../../core/context.js';
import { HttpError } from '../../core/http.js';
import { nextRun, validTimezone } from './schedule.js';
import { validateScript } from './scripts.js';
import type { Job, JobKind, PlanJob } from './types.js';
function view(job: Job) {
  const schedule = JSON.parse(job.schedule);
  const upcoming: number[] = [];
  try {
    let at = job.status === 'active' ? job.next_run : nextRun(schedule, Date.now(), true);
    for (let i = 0; i < 3 && at !== null; i++) {
      upcoming.push(at);
      at = schedule.kind === 'once' ? null : nextRun(schedule, at);
    }
  } catch {
    /* Expired drafts remain visible for deletion/recreation. */
  }
  return { ...job, schedule, upcoming, script_state: undefined };
}
export function jobRoutes(ctx: Context, kind: JobKind, planJob: PlanJob) {
  const { store } = ctx;
  const router = Router();
  router.get('/', (req, res) =>
    res.json(
      store
        .all<Job>(
          'SELECT * FROM jobs WHERE user_id=? AND kind=? ORDER BY created_at DESC',
          req.user!.id,
          kind,
        )
        .map(view),
    ),
  );
  router.post(
    '/prepare',
    rateLimit({
      windowMs: 300000,
      limit: 5,
      keyGenerator: (req) => req.user!.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Maximal fünf Entwürfe in fünf Minuten. Bitte kurz warten.' },
    }),
    async (req, res) => {
      const data = z
        .object({
          prompt: z.string().trim().min(1).max(16000),
          timezone: z.string().max(100),
          allowAI: z.boolean().default(false),
        })
        .parse(req.body);
      if (!validTimezone(data.timezone)) throw new HttpError(400, 'Ungültige Zeitzone.');
      const quota = () => {
        if (
          store.get<{ n: number }>('SELECT COUNT(*) n FROM jobs WHERE user_id=?', req.user!.id)!
            .n >= 40
        )
          throw new HttpError(
            400,
            'Maximal 40 Aufgaben und Automatisierungen pro Nutzer. Bitte alte Einträge löschen.',
          );
      };
      quota();
      const plan = await planJob(
        req.user!.id,
        kind,
        data.prompt,
        data.timezone,
        kind === 'automation' && data.allowAI,
      );
      if (plan.clarification)
        return res.json({ clarification: z.string().max(2000).parse(plan.clarification) });
      const name = z.string().trim().min(1).max(100).parse(plan.name);
      const description = z.string().trim().min(1).max(2000).parse(plan.description);
      const prompt = z.string().trim().min(1).max(16000).parse(plan.prompt);
      if (plan.channel !== 'dashboard')
        throw new HttpError(
          400,
          'Der gewünschte Benachrichtigungskanal ist noch nicht verbunden. Eine Umleitung ins Dashboard erfolgt nicht.',
        );
      nextRun(plan.schedule, Date.now(), true);
      if (kind === 'automation') {
        try {
          await validateScript(plan.script || '');
        } catch {
          throw new HttpError(
            502,
            'Das erzeugte Skript ist ungültig. Bitte den Entwurf neu erstellen.',
          );
        }
      } else if (plan.script !== null) throw new HttpError(502, 'Ungültiger Aufgabenentwurf.');
      const id = randomUUID();
      store.transaction(() => {
        quota();
        store.run(
          "INSERT INTO jobs(id,user_id,kind,name,description,input_prompt,prompt,script,schedule,channel,allow_ai,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?)",
          id,
          req.user!.id,
          kind,
          name,
          description,
          data.prompt,
          prompt,
          kind === 'automation' ? plan.script : null,
          JSON.stringify(plan.schedule),
          plan.channel,
          Number(kind === 'automation' && data.allowAI),
          Date.now(),
        );
      });
      res.status(201).json({
        job: view(store.get<Job>('SELECT * FROM jobs WHERE id=? AND user_id=?', id, req.user!.id)!),
      });
    },
  );
  router.use('/:id', (req, _res, next) => {
    if (
      !store.get(
        'SELECT id FROM jobs WHERE id=? AND user_id=? AND kind=?',
        String(req.params.id),
        req.user!.id,
        kind,
      )
    )
      throw new HttpError(404, 'Eintrag nicht gefunden.');
    next();
  });
  router.get('/:id/runs', (req, res) =>
    res.json(
      store.all(
        'SELECT * FROM job_runs WHERE job_id=? ORDER BY created_at DESC LIMIT 20',
        String(req.params.id),
      ),
    ),
  );
  router.patch('/:id', (req, res) => {
    const { status } = z.object({ status: z.enum(['active', 'paused']) }).parse(req.body);
    const job = store.get<Job>(
      'SELECT * FROM jobs WHERE id=? AND user_id=?',
      String(req.params.id),
      req.user!.id,
    )!;
    if (status === 'active' && job.status === 'active') return res.json({ ok: true });
    if (status === 'paused' && job.status === 'draft')
      throw new HttpError(400, 'Der Entwurf ist noch nicht aktiviert.');
    if (
      status === 'active' &&
      store.get("SELECT id FROM job_runs WHERE job_id=? AND status='running'", job.id)
    )
      throw new HttpError(409, 'Eine Ausführung läuft noch.');
    const next =
      status === 'active' ? nextRun(JSON.parse(job.schedule), Date.now(), true) : job.next_run;
    store.run(
      'UPDATE jobs SET status=?,next_run=? WHERE id=? AND user_id=?',
      status,
      next,
      job.id,
      req.user!.id,
    );
    res.json({ ok: true });
  });
  router.delete('/:id', (req, res) => {
    store.run('DELETE FROM jobs WHERE id=? AND user_id=?', String(req.params.id), req.user!.id);
    res.json({ ok: true });
  });
  return router;
}
