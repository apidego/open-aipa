import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { token } from '../server/core/security.js';
const { list, retrieve } = vi.hoisted(() => ({ list: vi.fn(), retrieve: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    models = { list, retrieve };
  },
}));
let app: ReturnType<typeof createApp>, admin: ReturnType<typeof request.agent>;
const origin = 'http://localhost:3000';
beforeEach(async () => {
  list.mockReset().mockImplementation(async function* () {
    for (const id of [
      'gpt-6-luna',
      'gpt-6-astra',
      'gpt-image-1',
      'gpt-4o-audio-preview',
      'text-embedding-3-small',
    ])
      yield { id };
  });
  retrieve.mockReset().mockResolvedValue({});
  app = createApp(
    {
      url: origin,
      dataDir: mkdtempSync(join(tmpdir(), 'pa-models-')),
      encryptionKey: token(),
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
    vi.fn(),
  );
  admin = request.agent(app.app);
  await admin
    .post('/api/setup')
    .set('Origin', origin)
    .send({
      setupToken: app.ctx.config.setupToken,
      name: 'Admin',
      email: 'admin@example.test',
      password: 'test-password-long',
      apiKey: 'fake-openai-key',
      model: 'legacy-model',
    })
    .expect(201);
});
afterEach(async () => {
  await app.discord.stop();
  app.ctx.store.db.close();
  rmSync(app.ctx.config.dataDir, { recursive: true, force: true });
});
it('preserves legacy defaults and saves all three models atomically without exposing credentials', async () => {
  expect((await admin.get('/api/settings')).body).toMatchObject({
    model: 'legacy-model',
    complexModel: 'legacy-model',
    taskModel: 'legacy-model',
  });
  const settings = {
    model: 'gpt-6-luna',
    complexModel: 'gpt-6-astra',
    taskModel: 'gpt-6.1-sol',
    systemPrompt: 'Be useful.',
  };
  await admin.put('/api/settings').set('Origin', origin).send(settings).expect(200);
  const saved = (await admin.get('/api/settings')).body;
  expect(saved).toMatchObject(settings);
  expect(JSON.stringify(saved)).not.toContain('fake-openai-key');
  await admin
    .put('/api/settings')
    .set('Origin', origin)
    .send({ ...settings, complexModel: '' })
    .expect(400);
  expect(app.ctx.store.setting('complexModel')).toBe('gpt-6-astra');
  await admin.post('/api/settings/test').set('Origin', origin).send({}).expect(200);
  expect(retrieve.mock.calls.map((c) => c[0]).sort()).toEqual(
    ['gpt-6-luna', 'gpt-6-astra', 'gpt-6.1-sol'].sort(),
  );
});
it('loads searchable text candidates with stored models and sanitizes provider failures', async () => {
  expect((await admin.get('/api/settings/models').expect(200)).body.models).toEqual([
    'gpt-6-astra',
    'gpt-6-luna',
    'legacy-model',
  ]);
  list.mockImplementation(() => {
    throw new Error('secret-provider-details');
  });
  const result = await admin.get('/api/settings/models').expect(502);
  expect(result.body.error).not.toContain('secret-provider-details');
});
it('enforces authentication, administrator access and mutation origin checks', async () => {
  await request(app.app).get('/api/settings/models').expect(401);
  await admin
    .post('/api/users')
    .set('Origin', origin)
    .send({ name: 'Member', email: 'member@example.test', password: 'member-password-long' })
    .expect(201);
  const member = request.agent(app.app);
  await member
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'member@example.test', password: 'member-password-long' })
    .expect(200);
  await member.get('/api/settings/models').expect(403);
  await member
    .put('/api/settings')
    .set('Origin', origin)
    .send({ model: 'other', complexModel: 'other', taskModel: 'other', systemPrompt: 'bad' })
    .expect(403);
  await admin
    .put('/api/settings')
    .send({ model: 'other', complexModel: 'other', taskModel: 'other', systemPrompt: 'bad' })
    .expect(403);
  expect(list).not.toHaveBeenCalled();
});
