import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/core/db.js';
import { Vault, token } from '../server/core/security.js';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { nextRun } from '../server/modules/jobs/schedule.js';
import { jobPlanner } from '../server/modules/jobs/planner.js';
import type { Context } from '../server/core/context.js';
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    responses = { parse };
  },
}));
let ctx: Context;
beforeEach(() => {
  parse.mockReset();
  const key = token(),
    dir = mkdtempSync(join(tmpdir(), 'pa-plan-'));
  ctx = {
    store: new Store(dir),
    vault: new Vault(key),
    config: {
      url: 'http://localhost:3000',
      dataDir: dir,
      encryptionKey: key,
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
  };
  ctx.store.set('apiKey', ctx.vault.seal('test-only'));
  ctx.store.set('model', 'configured-model');
  ctx.store.run(
    'INSERT INTO users VALUES(?,?,?,?,?,?)',
    'u',
    'u@example.test',
    'User',
    'hash',
    'user',
    1,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  ctx.store.db.close();
  rmSync(ctx.config.dataDir, { recursive: true, force: true });
});
it('generates structured plans with configured model, time context, script contract and only connected tools', async () => {
  ctx.store.set('taskModel', 'planning-model');
  ctx.store.run('INSERT INTO connections VALUES(?,?,?)', 'u', 'gmail', 'encrypted');
  parse.mockResolvedValue({
    status: 'completed',
    output_parsed: { clarification: 'Welche Uhrzeit?' },
  });
  await jobPlanner(ctx)('u', 'automation', 'Prüfe Gmail', 'Europe/Berlin', false);
  expect(parse.mock.calls[0][0]).toMatchObject({
    model: 'planning-model',
    store: false,
    text: { format: { type: 'json_schema', name: 'scheduled_job_plan', strict: true } },
  });
  expect(parse.mock.calls[0][0].instructions).toContain('gmail_search');
  expect(parse.mock.calls[0][0].instructions).toContain('AI permission: false');
  expect(parse.mock.calls[0][0].instructions).toContain('User timezone: Europe/Berlin');
  expect(parse.mock.calls[0][0].tools).toBeUndefined();
  expect(parse.mock.calls[0][0].instructions).toContain('notificationMode="always" by default');
  expect(parse.mock.calls[0][0].instructions).toContain(
    'Content filters such as excluding spam/newsletters are NOT a notification condition.',
  );
  expect(parse.mock.calls[0][0].instructions).toContain('Set channel="all" by default');
  expect(parse.mock.calls[0][0].instructions).toContain(
    '"nur Discord" / "über Discord" means channel="discord"',
  );
  expect(parse.mock.calls[0][0].instructions).toContain(
    '"nur Dashboard" means channel="dashboard"',
  );
});
it('does not accept refused or incomplete plans', async () => {
  parse.mockResolvedValueOnce({ status: 'completed', output_parsed: null });
  await expect(jobPlanner(ctx)('u', 'task', 'Test', 'UTC', false)).rejects.toThrow('Entwurf');
  parse.mockResolvedValueOnce({ status: 'incomplete', output_parsed: {} });
  await expect(jobPlanner(ctx)('u', 'task', 'Test', 'UTC', false)).rejects.toThrow('Entwurf');
});
it('offers Discord only for this owner when configured, enabled and linked', async () => {
  parse.mockResolvedValue({ status: 'completed', output_parsed: { clarification: 'Wann?' } });
  const plan = () => jobPlanner(ctx)('u', 'task', 'Melde dich über Discord', 'UTC', false);
  await plan();
  expect(parse.mock.lastCall![0].instructions).toContain('channels for this user: dashboard.');
  ctx.store.set('integration:discord:enabled', 'true');
  ctx.store.set('discordBotToken', ctx.vault.seal('fake'));
  ctx.store.run("INSERT INTO discord_links VALUES('link','u','111','222',NULL)");
  await plan();
  expect(parse.mock.lastCall![0].instructions).toContain(
    'channels for this user: dashboard, discord.',
  );
  ctx.store.set('integration:discord:enabled', 'false');
  await plan();
  expect(parse.mock.lastCall![0].instructions).toContain('channels for this user: dashboard.');
});

const relativePlan = {
  clarification: null,
  name: 'Hallo',
  description: 'In fünf Minuten Hallo sagen.',
  prompt: 'Sage hallo.',
  script: null,
  channel: 'all',
  notificationMode: 'always',
  schedule: { kind: 'delay', minutes: 5, at: null, cron: null, timezone: 'Europe/Berlin' },
};
it.each([
  ['2026-11-11T14:41:00Z', 'Europe/Berlin'],
  ['2026-03-29T00:58:00Z', 'Europe/Berlin'],
  ['2026-10-25T00:58:00Z', 'Europe/Berlin'],
  ['2026-11-11T23:58:00Z', 'Asia/Kolkata'],
])(
  'resolves five minutes from request time, regardless of offset/DST: %s %s',
  async (now, timezone) => {
    const started = Date.parse(now);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    parse.mockImplementation(async () => {
      clock.mockReturnValue(started + 12000);
      return { status: 'completed', output_parsed: relativePlan };
    });
    const plan = await jobPlanner(ctx)(
      'u',
      'task',
      'schreibe mir in 5 min "hallo"',
      timezone,
      false,
    );
    expect(plan.schedule).toEqual({
      kind: 'once',
      at: new Date(started + 300000).toISOString(),
      minutes: null,
      cron: null,
      timezone,
    });
    expect(nextRun(plan.schedule, Date.now(), true)).toBe(started + 300000);
    expect(parse.mock.lastCall![0].instructions).toContain(
      'NEVER calculate an absolute timestamp for these durations',
    );
  },
);
it.each([0, -5, 1.5, 525601])('rejects invalid relative durations: %s', async (minutes) => {
  parse.mockResolvedValue({
    status: 'completed',
    output_parsed: { ...relativePlan, schedule: { ...relativePlan.schedule, minutes } },
  });
  await expect(jobPlanner(ctx)('u', 'task', 'Hallo später', 'UTC', false)).rejects.toThrow();
});
it('preserves absolute dates and recurring intervals instead of converting them into delays', async () => {
  for (const schedule of [
    {
      kind: 'once',
      at: '2026-11-12T10:00:00+01:00',
      minutes: null,
      cron: null,
      timezone: 'Europe/Berlin',
    },
    { kind: 'interval', at: null, minutes: 5, cron: null, timezone: 'Europe/Berlin' },
  ]) {
    parse.mockResolvedValue({ status: 'completed', output_parsed: { ...relativePlan, schedule } });
    expect(
      (await jobPlanner(ctx)('u', 'task', 'Auftrag', 'Europe/Berlin', false)).schedule,
    ).toEqual(schedule);
  }
});
it('creates and activates the five-minute draft through the real planner and routes', async () => {
  const now = Date.parse('2026-11-11T14:41:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  parse.mockResolvedValue({ status: 'completed', output_parsed: relativePlan });
  const app = createApp(ctx.config, vi.fn(), jobPlanner(ctx));
  try {
    const a = request.agent(app.app);
    const origin = ctx.config.url;
    await a
      .post('/api/setup')
      .set('Origin', origin)
      .send({
        setupToken: ctx.config.setupToken,
        name: 'Test',
        email: 'test@example.test',
        password: 'test-password-long',
        apiKey: 'fake-test-key-not-real',
        model: 'test',
      })
      .expect(201);
    const prepared = await a
      .post('/api/tasks/prepare')
      .set('Origin', origin)
      .send({ prompt: 'schreibe mir in 5 min "hallo"', timezone: 'Europe/Berlin' })
      .expect(201);
    expect(prepared.body.job.upcoming).toEqual([now + 300000]);
    expect(prepared.body.job.schedule.kind).toBe('once');
    await a
      .patch('/api/tasks/' + prepared.body.job.id)
      .set('Origin', origin)
      .send({ status: 'active' })
      .expect(200);
    expect(
      app.ctx.store.get<{ next_run: number }>(
        'SELECT next_run FROM jobs WHERE id=?',
        prepared.body.job.id,
      )?.next_run,
    ).toBe(now + 300000);
  } finally {
    await app.discord.stop();
    app.ctx.store.db.close();
  }
});
