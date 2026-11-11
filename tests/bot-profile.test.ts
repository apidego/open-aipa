import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { token } from '../server/core/security.js';
import { syncBotProfile, profileSyncStatus } from '../server/modules/bot-profile.js';
let app: ReturnType<typeof createApp>;
let admin: ReturnType<typeof request.agent>;
const origin = 'http://localhost:3000';
beforeEach(async () => {
  app = createApp({
    url: origin,
    dataDir: mkdtempSync(join(tmpdir(), 'pa-profile-')),
    encryptionKey: token(),
    setupToken: token(),
    googleClientId: '',
    googleClientSecret: '',
  });
  admin = request.agent(app.app);
  await admin
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
});
afterEach(() => {
  app.ctx.store.db.close();
  rmSync(app.ctx.config.dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
it('restricts writes, normalizes images, preserves omitted avatars and removes explicitly', async () => {
  await request(app.app).get('/api/bot-profile').expect(401);
  await admin.put('/api/bot-profile').send({ name: 'Alex' }).expect(403);
  await admin
    .post('/api/users')
    .set('Origin', origin)
    .send({ name: 'User', email: 'user@example.test', password: 'long-test-password' })
    .expect(201);
  const user = request.agent(app.app);
  await user
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'user@example.test', password: 'long-test-password' })
    .expect(200);
  await user.put('/api/bot-profile').set('Origin', origin).send({ name: 'Alex' }).expect(403);
  const png = await sharp({
    create: { width: 300, height: 100, channels: 3, background: '#526f4a' },
  })
    .png()
    .toBuffer();
  const saved = await admin
    .put('/api/bot-profile')
    .set('Origin', origin)
    .send({ name: 'Alex', avatar: 'data:image/png;base64,' + png.toString('base64') })
    .expect(200);
  const meta = await sharp(Buffer.from(saved.body.avatar.split(',')[1], 'base64')).metadata();
  expect([meta.width, meta.height]).toEqual([256, 256]);
  const next = await admin
    .put('/api/bot-profile')
    .set('Origin', origin)
    .send({ name: 'Robin' })
    .expect(200);
  expect(next.body.avatar).toBe(saved.body.avatar);
  expect((await user.get('/api/bot-profile').expect(200)).body.name).toBe('Robin');
  await user.get('/api/bot-profile/sync').expect(403);
  for (const data of [
    { name: 'x' },
    { name: 'a'.repeat(33) },
    { name: 'Alex', avatar: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { name: 'Alex', avatar: 'data:image/png;base64,YmFk' },
  ])
    await admin.put('/api/bot-profile').set('Origin', origin).send(data).expect(400);
  expect(
    (
      await admin
        .put('/api/bot-profile')
        .set('Origin', origin)
        .send({ name: 'Alex', avatar: null })
        .expect(200)
    ).body.avatar,
  ).toBeNull();
});
function configured() {
  app.ctx.store.set('integration:discord:enabled', 'true');
  app.ctx.store.set('discordBotToken', app.ctx.vault.seal('test-secret'));
  app.ctx.store.set('botProfileConfigured', 'true');
  app.ctx.store.set('botName', 'Alex');
}
it('syncs only explicit profiles, sends once and resyncs a replacement bot', async () => {
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await syncBotProfile(app.ctx);
  expect(fetch).not.toHaveBeenCalled();
  configured();
  await syncBotProfile(app.ctx);
  await syncBotProfile(app.ctx);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toEqual([
    'https://discord.com/api/v10/users/@me',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ username: 'Alex', avatar: null }),
    }),
  ]);
  expect(profileSyncStatus(app.ctx).state).toBe('synced');
  app.ctx.store.set('discordBotToken', app.ctx.vault.seal('replacement'));
  await syncBotProfile(app.ctx);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('backs off rate limits, hides provider errors and ignores stale success', async () => {
  configured();
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ retry_after: 120, secret: 'private' }), { status: 429 }),
  );
  vi.stubGlobal('fetch', fetch);
  await syncBotProfile(app.ctx);
  await syncBotProfile(app.ctx);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(profileSyncStatus(app.ctx).state).toBe('error');
  expect(JSON.stringify(profileSyncStatus(app.ctx))).not.toContain('private');
  app.ctx.store.set('botName', 'Robin');
  fetch.mockImplementation(async () => {
    app.ctx.store.set('integration:discord:enabled', 'false');
    return new Response('{}');
  });
  await syncBotProfile(app.ctx);
  expect(profileSyncStatus(app.ctx).state).toBe('disabled');
  expect(app.ctx.store.setting('botDiscordSynced')).toBe('');
});
