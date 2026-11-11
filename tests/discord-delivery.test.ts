import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { token } from '../server/core/security.js';
import { discordDelivery } from '../server/integrations/discord-delivery.js';
import { discordRuntime } from '../server/integrations/discord-runtime.js';
import type { Plan } from '../server/modules/jobs/types.js';
const origin = 'http://localhost:3000';
let plannedChannel = 'discord';
let notificationMode: Plan['notificationMode'] = 'conditional';
const plan: Plan = {
  notificationMode: 'conditional',
  clarification: null,
  name: 'Terminprüfung',
  description: 'Bei Treffer per Discord benachrichtigen',
  prompt: 'Prüfe auf einen Termin; sonst schweige.',
  script: null,
  channel: 'discord',
  schedule: { kind: 'interval', minutes: 15, at: null, cron: null, timezone: 'Europe/Berlin' },
};
let app: ReturnType<typeof createApp>, a: ReturnType<typeof request.agent>, uid: string;
const run = vi.fn(async () =>
  JSON.stringify({ notify: true, title: 'Termin', message: 'Ein Termin steht an.' }),
);
const send = vi.fn(async (_channel: string, _content: string, _allowed?: () => boolean) => {});
beforeEach(async () => {
  plannedChannel = 'discord';
  notificationMode = 'conditional';
  run
    .mockReset()
    .mockResolvedValue(
      JSON.stringify({ notify: true, title: 'Termin', message: 'Ein Termin steht an.' }),
    );
  send.mockReset().mockResolvedValue(undefined);
  app = createApp(
    {
      url: origin,
      dataDir: mkdtempSync(join(tmpdir(), 'pa-delivery-')),
      encryptionKey: token(),
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
    run,
    async () => ({ ...plan, channel: plannedChannel, notificationMode }),
  );
  a = request.agent(app.app);
  await a
    .post('/api/setup')
    .set('Origin', origin)
    .send({
      setupToken: app.ctx.config.setupToken,
      name: 'Admin',
      email: 'admin@example.test',
      password: 'long-test-password',
      apiKey: 'sk-test-never-real',
      model: 'test',
    })
    .expect(201);
  uid = app.ctx.store.get<{ id: string }>('SELECT id FROM users')!.id;
  app.ctx.store.set('integration:discord:enabled', 'true');
  app.ctx.store.set('discordBotToken', app.ctx.vault.seal('fake'));
  app.ctx.store.run(
    'INSERT INTO discord_links VALUES(?,?,?,?,NULL)',
    'binding',
    uid,
    '111111111111111111',
    '222222222222222222',
  );
});
afterEach(async () => {
  await app.discord.stop();
  app.ctx.store.db.close();
  rmSync(app.ctx.config.dataDir, { recursive: true, force: true });
});
async function draft() {
  return (
    await a
      .post('/api/tasks/prepare')
      .set('Origin', origin)
      .send({ prompt: 'Morgen prüfen und über Discord melden', timezone: 'Europe/Berlin' })
      .expect(201)
  ).body.job;
}
async function activate(id: string) {
  await a
    .patch('/api/tasks/' + id)
    .set('Origin', origin)
    .send({ status: 'active', approveDiscord: true, discordBindingId: 'binding' })
    .expect(200);
  app.ctx.store.run('UPDATE jobs SET next_run=0 WHERE id=?', id);
}
function delivery() {
  return app.ctx.store.get<{ status: string; error: string }>(
    'SELECT status,error FROM discord_deliveries',
  );
}
it('requires reviewed recipient approval and rejects unavailable or changed links', async () => {
  const job = await draft();
  expect(job.discord_recipient).toBe('111111111111111111');
  for (const body of [
    { status: 'active' },
    { status: 'active', approveDiscord: true, discordBindingId: 'other' },
  ])
    await a
      .patch('/api/tasks/' + job.id)
      .set('Origin', origin)
      .send(body)
      .expect(409);
  await a
    .patch('/api/tasks/' + job.id)
    .send({ status: 'active', approveDiscord: true, discordBindingId: 'binding' })
    .expect(403);
  app.ctx.store.run('DELETE FROM discord_links');
  await a
    .patch('/api/tasks/' + job.id)
    .set('Origin', origin)
    .send({ status: 'active', approveDiscord: true, discordBindingId: 'binding' })
    .expect(409);
  await a
    .post('/api/tasks/prepare')
    .set('Origin', origin)
    .send({ prompt: 'Discord morgen', timezone: 'UTC' })
    .expect(400);
});
it('queues atomically, sends once to the bound DM and never creates a dashboard notification', async () => {
  const job = await draft();
  await activate(job.id);
  await app.tick();
  expect(delivery()?.status).toBe('pending');
  expect((await a.get('/api/notifications')).body.items).toEqual([]);
  const drain = discordDelivery(app.ctx, send, () => true);
  await Promise.all([drain(), drain()]);
  await drain();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toBe('222222222222222222');
  expect(send.mock.calls[0][2]!()).toBe(true);
  expect(delivery()?.status).toBe('sent');
  expect((await a.get('/api/tasks/' + job.id + '/runs')).body[0]).toMatchObject({
    status: 'completed',
    delivery_status: 'sent',
    notified: 1,
  });
});
it('does not enqueue or send when the condition is false', async () => {
  run.mockResolvedValue(JSON.stringify({ notify: false, title: '', message: 'Kein Treffer.' }));
  const job = await draft();
  await activate(job.id);
  await app.tick();
  await discordDelivery(app.ctx, send, () => true)();
  expect(delivery()).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});
it('fails visibly after replacement binding, deactivation, deletion or expiry without fallback', async () => {
  const job = await draft();
  await activate(job.id);
  await app.tick();
  app.ctx.store.run("UPDATE discord_links SET id='replacement'");
  await discordDelivery(app.ctx, send, () => true)();
  expect(delivery()?.status).toBe('failed');
  expect(send).not.toHaveBeenCalled();
  expect((await a.get('/api/notifications')).body.items).toEqual([]);
  app.ctx.store.run("UPDATE discord_links SET id='binding'");
  app.ctx.store.run('UPDATE jobs SET next_run=0');
  await app.tick();
  app.ctx.store.set('integration:discord:enabled', 'false');
  await discordDelivery(app.ctx, send, () => true)();
  expect(app.ctx.store.all("SELECT * FROM discord_deliveries WHERE status='failed'")).toHaveLength(
    2,
  );
  app.ctx.store.set('integration:discord:enabled', 'true');
  app.ctx.store.run('UPDATE jobs SET next_run=0');
  await app.tick();
  await a
    .delete('/api/tasks/' + job.id)
    .set('Origin', origin)
    .expect(200);
  await discordDelivery(app.ctx, send, () => true)();
  expect(app.ctx.store.all('SELECT * FROM discord_deliveries')).toEqual([]);
  expect(send).not.toHaveBeenCalled();
});
it('keeps offline sends pending up to 24 hours and fails interrupted sends on restart', async () => {
  const job = await draft();
  await activate(job.id);
  await app.tick();
  const drain = discordDelivery(app.ctx, send, () => false);
  await drain();
  expect(delivery()?.status).toBe('pending');
  app.ctx.store.run('UPDATE discord_deliveries SET created_at=?', Date.now() - 86400001);
  await drain();
  expect(delivery()?.status).toBe('failed');
  app.ctx.store.run("UPDATE discord_deliveries SET status='sending'");
  await discordDelivery(app.ctx, send, () => true)();
  expect(delivery()?.status).toBe('failed');
  expect(delivery()?.error).toContain('Neustart');
  expect(send).not.toHaveBeenCalled();
});
it('bounds chunks and never retries partial or uncertain failures', async () => {
  run.mockResolvedValue(
    JSON.stringify({ notify: true, title: 'Treffer', message: 'x'.repeat(16000) }),
  );
  const job = await draft();
  await activate(job.id);
  await app.tick();
  send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SECRET'));
  const drain = discordDelivery(app.ctx, send, () => true);
  await drain();
  await drain();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.every((c) => c[1].length <= 1900)).toBe(true);
  expect(delivery()?.status).toBe('failed');
  expect(delivery()?.error).not.toContain('SECRET');
});
it('rechecks authorization during a send and suppresses remaining chunks', async () => {
  run.mockResolvedValue(
    JSON.stringify({ notify: true, title: 'Treffer', message: 'x'.repeat(4000) }),
  );
  const job = await draft();
  await activate(job.id);
  await app.tick();
  send.mockImplementation(async () => {
    app.ctx.store.run('DELETE FROM discord_links');
  });
  await discordDelivery(app.ctx, send, () => true)();
  expect(send).toHaveBeenCalledTimes(1);
  expect(delivery()?.status).toBe('failed');
});
it('integrates the outbox with the active Discord runtime', async () => {
  const job = await draft();
  await activate(job.id);
  await app.tick();
  const runtime = discordRuntime(app.ctx, run, () => ({
    login: async () => {},
    destroy: async () => {},
    ready: () => true,
    send,
  }));
  await runtime.sync();
  await runtime.sync();
  await vi.waitFor(() => expect(delivery()?.status).toBe('sent'));
  await runtime.stop();
  expect(send).toHaveBeenCalledOnce();
  expect(delivery()?.status).toBe('sent');
});
it('scopes histories and approval to the owner', async () => {
  const job = await draft();
  await activate(job.id);
  await app.tick();
  await a
    .post('/api/users')
    .set('Origin', origin)
    .send({ name: 'Other', email: 'other@example.test', password: 'long-test-password' })
    .expect(201);
  const other = request.agent(app.app);
  await other
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'other@example.test', password: 'long-test-password' })
    .expect(200);
  await other.get('/api/tasks/' + job.id + '/runs').expect(404);
  await other
    .patch('/api/tasks/' + job.id)
    .set('Origin', origin)
    .send({ status: 'active', approveDiscord: true, discordBindingId: 'binding' })
    .expect(404);
});
it('migrates existing jobs and preserves pending deliveries across database reopen', async () => {
  const job = await draft();
  await activate(job.id);
  await app.tick();
  const config = app.ctx.config;
  await app.discord.stop();
  app.ctx.store.db.exec(
    'DROP TABLE discord_deliveries; DROP TABLE job_discord_targets; DELETE FROM migrations WHERE version=5;',
  );
  app.ctx.store.db.close();
  app = createApp(config, run, async () => plan);
  expect(app.ctx.store.get('SELECT id FROM jobs WHERE id=?', job.id)).toEqual({ id: job.id });
  expect(app.ctx.store.get('SELECT version FROM migrations WHERE version=5')).toEqual({
    version: 5,
  });
  a = request.agent(app.app);
  await a
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'admin@example.test', password: 'long-test-password' })
    .expect(200);
  await a
    .patch('/api/tasks/' + job.id)
    .set('Origin', origin)
    .send({ status: 'paused' })
    .expect(200);
  await activate(job.id);
  await app.tick();
  await app.discord.stop();
  app.ctx.store.db.close();
  app = createApp(config, run, async () => plan);
  expect(delivery()?.status).toBe('pending');
  await discordDelivery(app.ctx, send, () => true)();
  expect(delivery()?.status).toBe('sent');
});

it('defaults to both destinations, requires approval, and delivers one notification per channel', async () => {
  plannedChannel = 'all';
  const job = await draft();
  expect(job.channel).toBe('dashboard_discord');
  await a
    .patch('/api/tasks/' + job.id)
    .set('Origin', origin)
    .send({ status: 'active' })
    .expect(409);
  await activate(job.id);
  await app.tick();
  const notifications = (await a.get('/api/notifications')).body.items;
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({
    user_id: uid,
    channel: 'dashboard',
    message: 'Ein Termin steht an.',
  });
  expect(delivery()?.status).toBe('pending');
  await discordDelivery(app.ctx, send, () => true)();
  expect(send).toHaveBeenCalledTimes(1);
  expect(delivery()?.status).toBe('sent');
});
it('snapshots dashboard alone when Discord is unavailable and preserves explicit dashboard requests', async () => {
  plannedChannel = 'dashboard';
  expect((await draft()).channel).toBe('dashboard');
  plannedChannel = 'all';
  app.ctx.store.set('integration:discord:enabled', 'false');
  const job = await draft();
  expect(job.channel).toBe('dashboard');
  app.ctx.store.set('integration:discord:enabled', 'true');
  await a
    .patch('/api/tasks/' + job.id)
    .set('Origin', origin)
    .send({ status: 'active' })
    .expect(200);
  app.ctx.store.run('UPDATE jobs SET next_run=0 WHERE id=?', job.id);
  await app.tick();
  expect((await a.get('/api/notifications')).body.items).toHaveLength(1);
  expect(delivery()).toBeUndefined();
});
it('keeps the approved dashboard delivery if Discord is disconnected after activation', async () => {
  plannedChannel = 'all';
  const job = await draft();
  await activate(job.id);
  app.ctx.store.run('DELETE FROM discord_links');
  await app.tick();
  expect(delivery()?.status).toBe('failed');
  expect((await a.get('/api/notifications')).body.items).toHaveLength(1);
  expect((await a.get('/api/tasks/' + job.id + '/runs')).body[0].notified).toBe(1);
  await discordDelivery(app.ctx, send, () => true)();
  expect(send).not.toHaveBeenCalled();
});
it('suppresses both default channels when the condition is false', async () => {
  plannedChannel = 'all';
  run.mockResolvedValue(JSON.stringify({ notify: false, title: '', message: 'Kein Treffer.' }));
  const job = await draft();
  await activate(job.id);
  await app.tick();
  expect(delivery()).toBeUndefined();
  expect((await a.get('/api/notifications')).body.items).toEqual([]);
});

it('delivers an unconditional summary to both channels even when the model returns notify=false', async () => {
  plannedChannel = 'all';
  notificationMode = 'always';
  run.mockResolvedValue(
    JSON.stringify({
      notify: false,
      title: 'Zusammenfassung',
      message: 'Die angeforderte Zusammenfassung.',
    }),
  );
  const job = await draft();
  expect(job.notification_mode).toBe('always');
  await activate(job.id);
  await app.tick();
  expect((await a.get('/api/notifications')).body.items).toHaveLength(1);
  expect(delivery()?.status).toBe('pending');
  await discordDelivery(app.ctx, send, () => true)();
  expect(send).toHaveBeenCalledTimes(1);
  expect(delivery()?.status).toBe('sent');
});
it('does not deliver an unconditional task when execution fails', async () => {
  plannedChannel = 'all';
  notificationMode = 'always';
  run.mockRejectedValue(new Error('mock failure'));
  const job = await draft();
  await activate(job.id);
  await app.tick();
  expect((await a.get('/api/notifications')).body.items).toEqual([]);
  expect(delivery()).toBeUndefined();
  expect((await a.get('/api/tasks/' + job.id + '/runs')).body[0].status).toBe('failed');
});
