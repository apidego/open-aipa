import { randomUUID } from 'node:crypto';
import type { Context } from '../../core/context.js';
import type { RunAgent } from '../agent.js';
import { nextRun } from './schedule.js';
import { runScript } from './scripts.js';
import { deliver } from './notifications.js';
import { outcomeSchema, type Job } from './types.js';
export function scheduler(ctx: Context, runAgent: RunAgent) {
  const { store } = ctx;
  let running = false;
  store.transaction(() => {
    store.run(
      "UPDATE job_runs SET status='failed',result='Serverneustart hat die Ausführung unterbrochen.',finished_at=? WHERE status='running'",
      Date.now(),
    );
    store.run("UPDATE jobs SET status='completed' WHERE status='active' AND next_run IS NULL");
  });
  return async () => {
    if (running || !store.setting('initialized')) return;
    running = true;
    try {
      const due = store.all<Job>(
        "SELECT * FROM jobs WHERE status='active' AND next_run<=? ORDER BY next_run LIMIT 5",
        Date.now(),
      );
      for (const job of due) {
        const runId = randomUUID();
        let next: number | null;
        try {
          const schedule = JSON.parse(job.schedule);
          next = schedule.kind === 'once' ? null : nextRun(schedule);
        } catch {
          store.run("UPDATE jobs SET status='paused' WHERE id=?", job.id);
          continue;
        }
        const claimed = store.transaction(() => {
          const changed = store.run(
            "UPDATE jobs SET next_run=? WHERE id=? AND status='active' AND next_run<=?",
            next,
            job.id,
            Date.now(),
          ).changes;
          if (changed)
            store.run(
              "INSERT INTO job_runs(id,job_id,status,created_at) VALUES(?,?,'running',?)",
              runId,
              job.id,
              Date.now(),
            );
          return changed;
        });
        if (!claimed) continue;
        try {
          const outcome =
            job.kind === 'automation'
              ? await runScript(ctx, job, runAgent)
              : outcomeSchema.parse(
                  JSON.parse(
                    await runAgent(
                      job.user_id,
                      [{ role: 'user', content: job.prompt }],
                      undefined,
                      { task: true, signal: AbortSignal.timeout(120000) },
                    ),
                  ),
                );
          store.transaction(() => {
            if (!store.get('SELECT id FROM jobs WHERE id=? AND user_id=?', job.id, job.user_id))
              return;
            deliver(ctx, job, runId, outcome);
            store.run(
              "UPDATE job_runs SET status='completed',result=?,notified=?,finished_at=? WHERE id=?",
              outcome.message,
              Number(outcome.notify && job.channel === 'dashboard'),
              Date.now(),
              runId,
            );
            if ('state' in outcome && typeof outcome.state === 'string')
              store.run('UPDATE jobs SET script_state=? WHERE id=?', outcome.state, job.id);
          });
        } catch {
          store.run(
            "UPDATE job_runs SET status='failed',result='Ausführung fehlgeschlagen. Auftrag, Berechtigungen und Integrationen prüfen.',finished_at=? WHERE id=?",
            Date.now(),
            runId,
          );
        } finally {
          store.run(
            "UPDATE jobs SET status='completed' WHERE id=? AND status='active' AND next_run IS NULL",
            job.id,
          );
        }
      }
    } finally {
      running = false;
    }
  };
}
