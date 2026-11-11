import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { token } from '../server/core/security.js';
import { Store } from '../server/core/db.js';
import { nextRun, type Schedule } from '../server/modules/jobs/schedule.js';
import { runScript, validateScript } from '../server/modules/jobs/scripts.js';
import { gmail } from '../server/integrations/gmail.js';
import type { Job, Plan } from '../server/modules/jobs/types.js';
const origin = 'http://localhost:3000';
const interval: Schedule = {
  kind: 'interval',
  minutes: 15,
  at: null,
  cron: null,
  timezone: 'Europe/Berlin',
};
const script =
  'return {notify:true,title:"Ergebnis",message:"Ohne KI ausgeführt",state:{count:(pa.state.count||0)+1}};';
const plan: Plan = {
  notificationMode: 'conditional',
  clarification: null,
  name: 'Prüfung',
  description: 'Regelmäßige Prüfung',
  prompt: 'Prüfe die Bedingung und benachrichtige nur bei einem Treffer.',
  script,
  schedule: interval,
  channel: 'dashboard',
};
let instance: ReturnType<typeof createApp>, dir: string;
const runAgent = vi.fn(async () =>
  JSON.stringify({ notify: true, title: 'Treffer', message: 'Ein Termin wurde gefunden.' }),
);
const planner = vi.fn(async (_uid: string, kind: string) => ({
  ...plan,
  script: kind === 'automation' ? script : null,
}));
beforeEach(() => {
  runAgent
    .mockReset()
    .mockResolvedValue(
      JSON.stringify({ notify: true, title: 'Treffer', message: 'Ein Termin wurde gefunden.' }),
    );
  planner.mockReset().mockImplementation(async (_uid, kind) => ({
    ...plan,
    script: kind === 'automation' ? script : null,
  }));
  dir = mkdtempSync(join(tmpdir(), 'pa-jobs-'));
  instance = createApp(
    {
      url: origin,
      dataDir: dir,
      encryptionKey: token(),
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
    runAgent,
    planner,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  instance.ctx.store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  const a = request.agent(instance.app);
  await a
    .post('/api/setup')
    .set('Origin', origin)
    .send({
      setupToken: instance.ctx.config.setupToken,
      name: 'Admin',
      email: 'admin@example.test',
      password: 'test-password-long',
      apiKey: 'sk-test-only',
      model: 'test-model',
    })
    .expect(201);
  return a;
}
async function draft(a: Awaited<ReturnType<typeof setup>>, kind = 'automations', allowAI = false) {
  const r = await a
    .post(`/api/${kind}/prepare`)
    .set('Origin', origin)
    .send({ prompt: 'Alle 15 Minuten prüfen', timezone: 'Europe/Berlin', allowAI })
    .expect(201);
  return r.body.job as Job;
}
async function activate(a: Awaited<ReturnType<typeof setup>>, job: Job, kind = 'automations') {
  await a
    .patch(`/api/${kind}/${job.id}`)
    .set('Origin', origin)
    .send({ status: 'active' })
    .expect(200);
  instance.ctx.store.run('UPDATE jobs SET next_run=0 WHERE id=?', job.id);
}
function stored(id: string) {
  return instance.ctx.store.get<Job>('SELECT * FROM jobs WHERE id=?', id)!;
}
it('runs scripts without a model, commits state, notifies once and respects pause', async () => {
  const a = await setup(),
    job = await draft(a);
  await instance.tick();
  expect(runAgent).not.toHaveBeenCalled();
  expect(instance.ctx.store.all('SELECT * FROM job_runs')).toHaveLength(0);
  await activate(a, job);
  await Promise.all([instance.tick(), instance.tick()]);
  await instance.tick();
  expect(runAgent).not.toHaveBeenCalled();
  expect(planner).toHaveBeenCalledTimes(1);
  expect(JSON.parse(stored(job.id).script_state)).toEqual({ count: 1 });
  expect((await a.get('/api/notifications')).body.items).toHaveLength(1);
  expect((await a.get(`/api/automations/${job.id}/runs`)).body[0]).toMatchObject({
    status: 'completed',
    notified: 1,
    result: 'Ohne KI ausgeführt',
  });
  await a
    .patch(`/api/automations/${job.id}`)
    .set('Origin', origin)
    .send({ status: 'paused' })
    .expect(200);
  instance.ctx.store.run('UPDATE jobs SET next_run=0');
  await instance.tick();
  expect(instance.ctx.store.all('SELECT * FROM job_runs')).toHaveLength(1);
});
it('runs a task with AI and suppresses notifications on negative conditions', async () => {
  const a = await setup(),
    job = await draft(a, 'tasks');
  await activate(a, job, 'tasks');
  runAgent.mockResolvedValueOnce(
    JSON.stringify({ notify: false, title: '', message: 'Kein passender Treffer.' }),
  );
  await instance.tick();
  expect(runAgent).toHaveBeenCalledWith(
    job.user_id,
    [{ role: 'user', content: plan.prompt }],
    undefined,
    expect.objectContaining({ task: true }),
  );
  expect((await a.get('/api/notifications')).body.items).toHaveLength(0);
  expect((await a.get(`/api/tasks/${job.id}/runs`)).body[0]).toMatchObject({
    status: 'completed',
    notified: 0,
  });
  instance.ctx.store.run('UPDATE jobs SET next_run=0');
  await instance.tick();
  expect((await a.get('/api/notifications')).body.unread).toBe(1);
});
it('isolates jobs, runs and notifications and marks only owned notifications read', async () => {
  const a = await setup();
  await a
    .post('/api/users')
    .set('Origin', origin)
    .send({ name: 'Other', email: 'other@example.test', password: 'test-password-long' })
    .expect(201);
  const b = request.agent(instance.app);
  await b
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'other@example.test', password: 'test-password-long' })
    .expect(200);
  const job = await draft(a);
  await activate(a, job);
  await instance.tick();
  expect((await b.get('/api/automations')).body).toEqual([]);
  await b.get(`/api/automations/${job.id}/runs`).expect(404);
  await b
    .patch(`/api/automations/${job.id}`)
    .set('Origin', origin)
    .send({ status: 'active' })
    .expect(404);
  await b.delete(`/api/automations/${job.id}`).set('Origin', origin).expect(404);
  await a.get(`/api/tasks/${job.id}/runs`).expect(404);
  const n = (await a.get('/api/notifications')).body.items[0];
  expect((await b.get('/api/notifications')).body.items).toEqual([]);
  await b.patch(`/api/notifications/${n.id}/read`).set('Origin', origin).expect(404);
  await a.patch(`/api/notifications/${n.id}/read`).set('Origin', origin).expect(200);
  expect((await a.get('/api/notifications')).body.unread).toBe(0);
});
it('executes overdue one-off tasks once and does not reactivate an expired time', async () => {
  planner.mockImplementation(async () => ({
    ...plan,
    script: null,
    schedule: {
      kind: 'once',
      at: new Date(Date.now() + 60000).toISOString(),
      minutes: null,
      cron: null,
      timezone: 'Europe/Berlin',
    },
  }));
  const a = await setup(),
    job = await draft(a, 'tasks');
  await activate(a, job, 'tasks');
  await instance.tick();
  await instance.tick();
  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(stored(job.id).status).toBe('completed');
  expect(stored(job.id).next_run).toBeNull();
  instance.ctx.store.run(
    'UPDATE jobs SET schedule=? WHERE id=?',
    JSON.stringify({ ...interval, kind: 'once', minutes: null, at: '2020-01-01T10:00:00Z' }),
    job.id,
  );
  await a
    .patch(`/api/tasks/${job.id}`)
    .set('Origin', origin)
    .send({ status: 'active' })
    .expect(400);
});
it('rejects unsupported destinations, malformed scripts, invalid schedules and exposes clarification without activation', async () => {
  const a = await setup();
  planner.mockResolvedValueOnce({ ...plan, clarification: 'Discord ist nicht verbunden.' });
  const q = await a
    .post('/api/automations/prepare')
    .set('Origin', origin)
    .send({ prompt: 'Nur Discord', timezone: 'Europe/Berlin' })
    .expect(200);
  expect(q.body.clarification).toContain('Discord');
  planner.mockResolvedValueOnce({ ...plan, channel: 'discord' });
  await a
    .post('/api/automations/prepare')
    .set('Origin', origin)
    .send({ prompt: 'Test', timezone: 'UTC' })
    .expect(400);
  planner.mockResolvedValueOnce({ ...plan, script: 'return {' });
  await a
    .post('/api/automations/prepare')
    .set('Origin', origin)
    .send({ prompt: 'Test', timezone: 'UTC' })
    .expect(502);
  planner.mockResolvedValueOnce({ ...plan, schedule: { ...interval, minutes: 0 } });
  await a
    .post('/api/automations/prepare')
    .set('Origin', origin)
    .send({ prompt: 'Test', timezone: 'UTC' })
    .expect(400);
  expect(instance.ctx.store.all('SELECT * FROM jobs')).toHaveLength(0);
});
it('uses only connected integration capabilities as the job owner', async () => {
  const a = await setup();
  planner.mockResolvedValueOnce({
    ...plan,
    script: `const search=pa.tool('gmail_search',{query:'from:example@example.test'});const mail=pa.tool('gmail_read',{id:search.messages[0].id});return {notify:true,title:'Mail',message:mail.text,state:{}};`,
  });
  const job = await draft(a);
  instance.ctx.store.set('integration:gmail:enabled', 'true');
  instance.ctx.store.run(
    'INSERT INTO connections VALUES(?,?,?)',
    job.user_id,
    'gmail',
    'test-encrypted',
  );
  const execute = vi
    .spyOn(gmail, 'execute')
    .mockResolvedValueOnce({ messages: [{ id: 'abc123' }] })
    .mockResolvedValueOnce({ text: 'Termin am Freitag' });
  await activate(a, job);
  await instance.tick();
  expect(execute.mock.calls.every((call) => call[1] === job.user_id)).toBe(true);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(runAgent).not.toHaveBeenCalled();
  expect((await a.get('/api/notifications')).body.items[0].message).toBe('Termin am Freitag');
  instance.ctx.store.run('DELETE FROM connections');
  instance.ctx.store.run('UPDATE jobs SET next_run=0');
  await instance.tick();
  expect(execute).toHaveBeenCalledTimes(2);
  expect((await a.get(`/api/automations/${job.id}/runs`)).body[0].status).toBe('failed');
});
it('requires explicit AI permission even when the generated script calls pa.ai', async () => {
  const a = await setup();
  planner.mockImplementation(async () => ({
    ...plan,
    script: `return {notify:true,title:'KI',message:pa.ai('Test'),state:{}};`,
  }));
  const denied = await draft(a);
  await activate(a, denied);
  await instance.tick();
  expect(runAgent).not.toHaveBeenCalled();
  const allowed = await draft(a, 'automations', true);
  await activate(a, allowed);
  await instance.tick();
  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(runAgent).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Array),
    undefined,
    expect.objectContaining({ scenario: 'tasks' }),
  );
});
it('bounds CPU, heap, host calls, output and blocks Node/environment/network access', async () => {
  const a = await setup(),
    job = await draft(a);
  const base = stored(job.id);
  const badScripts = [
    'while(true){}',
    'return {notify:true,title:"x",message:process.env.SECRET,state:{}};',
    'return require("node:fs").readFileSync(".env");',
    'fetch("https://example.com");',
    'return {notify:true,title:"x",message:"x".repeat(60000),state:{}};',
    'const a=[];while(true)a.push("x".repeat(100000));',
  ];
  for (const source of badScripts)
    await expect(
      runScript(instance.ctx, { ...base, script: source }, runAgent, 30),
    ).rejects.toThrow();
  expect(runAgent).not.toHaveBeenCalled();
  await expect(validateScript('}); while(true){}; (function(){')).rejects.toThrow();
});
it('records failures without leaking secrets or persisting script state', async () => {
  const a = await setup();
  planner.mockResolvedValueOnce({
    ...plan,
    script: 'pa.state.changed=true;throw new Error("sensitive credentials");',
  });
  const job = await draft(a);
  await activate(a, job);
  await instance.tick();
  const result = (await a.get(`/api/automations/${job.id}/runs`)).body[0];
  expect(result.status).toBe('failed');
  expect(result.result).not.toContain('sensitive');
  expect(stored(job.id).script_state).toBe('{}');
  expect((await a.get('/api/notifications')).body.items).toHaveLength(0);
});
it('does not deliver results when a task is deleted during execution', async () => {
  const a = await setup(),
    job = await draft(a, 'tasks');
  await activate(a, job, 'tasks');
  let release!: (s: string) => void;
  runAgent.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
  const tick = instance.tick();
  await a.delete(`/api/tasks/${job.id}`).set('Origin', origin).expect(200);
  release(JSON.stringify({ notify: true, title: 'Gone', message: 'No delivery' }));
  await tick;
  expect((await a.get('/api/notifications')).body.items).toHaveLength(0);
});
it('migrates legacy automations and run history to tasks exactly once', () => {
  const { store } = instance.ctx;
  store.db.exec(
    'DROP TABLE notifications;DROP TABLE job_runs;DROP TABLE jobs;DELETE FROM migrations WHERE version IN (2,6);',
  );
  store.run(
    'INSERT INTO users VALUES(?,?,?,?,?,?)',
    'legacy',
    'legacy@example.test',
    'Legacy',
    'hash',
    'user',
    1,
  );
  store.run(
    'INSERT INTO automations VALUES(?,?,?,?,?,?,?)',
    'old',
    'legacy',
    'Old job',
    'Check inbox',
    30,
    12345,
    1,
  );
  store.run(
    'INSERT INTO runs VALUES(?,?,?,?,?)',
    'old-run',
    'old',
    'completed',
    'Previous result',
    99,
  );
  store.db.close();
  const migrated = new Store(dir);
  instance.ctx.store = migrated;
  expect(migrated.get<Job>('SELECT * FROM jobs WHERE id=?', 'old')).toMatchObject({
    kind: 'task',
    name: 'Old job',
    prompt: 'Check inbox',
    status: 'active',
    next_run: 12345,
  });
  expect(
    migrated.get<{ result: string }>('SELECT * FROM job_runs WHERE id=?', 'old-run')?.result,
  ).toBe('Previous result');
  migrated.db.close();
  instance.ctx.store = new Store(dir);
  expect(instance.ctx.store.all('SELECT * FROM jobs')).toHaveLength(1);
});
it('computes intervals, timezone-aware cron and DST transitions deterministically', () => {
  expect(nextRun(interval, 0)).toBe(900000);
  const daily: Schedule = {
    kind: 'cron',
    at: null,
    minutes: null,
    cron: '0 10 * * *',
    timezone: 'Europe/Berlin',
  };
  expect(new Date(nextRun(daily, Date.parse('2026-03-28T10:00:00Z'))!).toISOString()).toBe(
    '2026-03-29T08:00:00.000Z',
  );
  expect(new Date(nextRun(daily, Date.parse('2026-10-24T10:00:00Z'))!).toISOString()).toBe(
    '2026-10-25T09:00:00.000Z',
  );
  expect(() => nextRun({ ...daily, cron: '* * * * * *' })).toThrow();
  expect(() => nextRun({ ...daily, timezone: 'Not/AZone' })).toThrow();
  expect(() => nextRun({ ...daily, cron: '0 10 5 * 1' })).toThrow();
});
it('caps tool calls and rejects connected tools not explicitly approved for scripts', async () => {
  const a = await setup(),
    job = await draft(a);
  instance.ctx.store.set('integration:gmail:enabled', 'true');
  instance.ctx.store.run(
    'INSERT INTO connections VALUES(?,?,?)',
    job.user_id,
    'gmail',
    'encrypted',
  );
  const execute = vi.spyOn(gmail, 'execute').mockResolvedValue({ messages: [] });
  const base = stored(job.id);
  await expect(
    runScript(
      instance.ctx,
      {
        ...base,
        script:
          "for(let i=0;i<21;i++)pa.tool('gmail_search',{query:'x'});return {notify:false,title:'',message:'',state:{}};",
      },
      runAgent,
    ),
  ).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(20);
  vi.spyOn(gmail, 'scriptTools', 'get').mockReturnValue([]);
  await expect(
    runScript(instance.ctx, { ...base, script: "pa.tool('gmail_search',{query:'x'});" }, runAgent),
  ).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(20);
});

it('preserves existing task policies and data when migrating version 5', async () => {
  const a = await setup();
  const job = await draft(a, 'tasks');
  instance.ctx.store.db.exec(
    'ALTER TABLE jobs DROP COLUMN notification_mode;DELETE FROM migrations WHERE version=6;',
  );
  instance.ctx.store.db.close();
  instance.ctx.store = new Store(dir);
  expect(instance.ctx.store.get<Job>('SELECT * FROM jobs WHERE id=?', job.id)).toMatchObject({
    id: job.id,
    prompt: job.prompt,
    status: 'draft',
    notification_mode: 'conditional',
  });
});
