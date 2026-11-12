import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { token, Vault } from '../server/core/security.js';
import type { Config } from '../server/core/config.js';
const origin = 'http://localhost:3000';
const account = {
  name: 'Admin',
  email: 'admin@example.com',
  password: 'a-long-test-password',
  apiKey: 'sk-test-key-never-real',
  model: 'test-model',
};
let config: Config;
let instance: ReturnType<typeof createApp>;
const runAgent = vi.fn(async (_userId, _messages, delta) => {
  delta?.('Hello ');
  delta?.('world');
  return 'Hello world';
});
beforeEach(() => {
  runAgent.mockClear();
  config = {
    url: origin,
    dataDir: mkdtempSync(join(tmpdir(), 'pa-test-')),
    encryptionKey: token(),
    setupToken: token(),
    googleClientId: '',
    googleClientSecret: '',
  };
  instance = createApp(config, runAgent);
});
afterEach(() => {
  instance.ctx.store.db.close();
  rmSync(config.dataDir, { recursive: true, force: true });
});
async function setup() {
  const agent = request.agent(instance.app);
  await agent
    .post('/api/setup')
    .set('Origin', origin)
    .send({ ...account, setupToken: config.setupToken })
    .expect(201);
  await agent
    .put('/api/integrations/gmail/activation')
    .set('Origin', origin)
    .send({ enabled: true })
    .expect(200);
  return agent;
}
async function member(admin: Awaited<ReturnType<typeof setup>>) {
  await admin
    .post('/api/users')
    .set('Origin', origin)
    .send({ name: 'Member', email: 'member@example.com', password: account.password })
    .expect(201);
  const agent = request.agent(instance.app);
  await agent
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'member@example.com', password: account.password })
    .expect(200);
  return agent;
}
describe('setup and authentication', () => {
  it('requires a setup token, locks setup, hashes credentials and encrypts secrets', async () => {
    await request(instance.app)
      .get('/api/session')
      .expect(200)
      .expect((r) => expect(r.body.setupRequired).toBe(true));
    await request(instance.app)
      .post('/api/setup')
      .set('Origin', origin)
      .send({ ...account, setupToken: 'wrong' })
      .expect(403);
    const admin = await setup();
    await admin
      .post('/api/setup')
      .set('Origin', origin)
      .send({ ...account, setupToken: config.setupToken })
      .expect(409);
    expect(instance.ctx.store.setting('apiKey')).not.toContain(account.apiKey);
    const stored = instance.ctx.store.get<{ password: string }>(
      'SELECT password FROM users',
    )!.password;
    expect(stored).not.toBe(account.password);
    const result = await admin.get('/api/session').expect(200);
    expect(result.body.user.role).toBe('admin');
    expect(JSON.stringify(result.body)).not.toContain('password');
    await admin.post('/api/logout').set('Origin', origin).expect(200);
    await admin.get('/api/dashboard').expect(401);
  });
  it('prevents concurrent first-admin creation', async () => {
    const responses = await Promise.all(
      [1, 2].map((i) =>
        request(instance.app)
          .post('/api/setup')
          .set('Origin', origin)
          .send({ ...account, email: `admin${i}@example.com`, setupToken: config.setupToken }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(instance.ctx.store.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n).toBe(1);
  });
  it('rejects cross-origin or originless writes and unauthenticated access', async () => {
    await request(instance.app).get('/api/users').expect(401);
    await request(instance.app).post('/api/login').send({}).expect(403);
    await request(instance.app)
      .post('/api/login')
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    await request(instance.app)
      .post('/api/login')
      .set('Origin', origin)
      .send({ email: 'none@example.com', password: 'invalid' })
      .expect(401);
  });
  it('enforces admin-only users/settings and revokes sessions on password changes', async () => {
    const admin = await setup();
    const user = await member(admin);
    await user.get('/api/users').expect(403);
    await user.get('/api/settings').expect(403);
    await user.post('/api/users').set('Origin', origin).send({}).expect(403);
    await user
      .post('/api/password')
      .set('Origin', origin)
      .send({ currentPassword: 'wrong', password: 'my-new-long-password' })
      .expect(403);
    const other = request.agent(instance.app);
    await other
      .post('/api/login')
      .set('Origin', origin)
      .send({ email: 'member@example.com', password: account.password })
      .expect(200);
    await user
      .post('/api/password')
      .set('Origin', origin)
      .send({ currentPassword: account.password, password: 'my-new-long-password' })
      .expect(200);
    await other.get('/api/dashboard').expect(401);
    await user.get('/api/dashboard').expect(200);
  });
  it('expires sessions and prevents deleting the current admin', async () => {
    const admin = await setup();
    const { body } = await admin.get('/api/session');
    await admin.delete(`/api/users/${body.user.id}`).set('Origin', origin).expect(400);
    instance.ctx.store.run('UPDATE sessions SET expires_at=0');
    await admin.get('/api/dashboard').expect(401);
  });
});
describe('conversations and integrations', () => {
  it('isolates conversations and streams a complete, persisted exchange', async () => {
    const admin = await setup();
    const user = await member(admin);
    const { body } = await admin
      .post('/api/conversations')
      .set('Origin', origin)
      .send({})
      .expect(201);
    await user.get(`/api/conversations/${body.id}`).expect(404);
    await user.delete(`/api/conversations/${body.id}`).set('Origin', origin).expect(404);
    await user
      .post(`/api/conversations/${body.id}/messages`)
      .set('Origin', origin)
      .send({ content: 'steal' })
      .expect(404);
    const answer = await admin
      .post(`/api/conversations/${body.id}/messages`)
      .set('Origin', origin)
      .send({ content: 'Plan my day' })
      .expect(200);
    expect(answer.text).toContain('event: delta');
    expect(answer.text).toContain('event: done');
    const history = await admin.get(`/api/conversations/${body.id}`).expect(200);
    expect(history.body.map((m: any) => m.content)).toEqual(['Plan my day', 'Hello world']);
    expect((await user.get('/api/conversations')).body).toEqual([]);
    expect(runAgent.mock.calls[0][1]).toEqual([{ role: 'user', content: 'Plan my day' }]);
    expect((runAgent.mock.calls[0] as any)[3].conversationId).toBe(body.id);
  });
  it('does not persist failed exchanges and permits retry', async () => {
    const admin = await setup();
    const { body } = await admin.post('/api/conversations').set('Origin', origin).send({});
    runAgent.mockRejectedValueOnce(new Error('secret upstream failure'));
    const failed = await admin
      .post(`/api/conversations/${body.id}/messages`)
      .set('Origin', origin)
      .send({ content: 'hello' });
    expect(failed.text).toContain('event: error');
    expect(failed.text).not.toContain('secret upstream');
    expect((await admin.get(`/api/conversations/${body.id}`)).body).toEqual([]);
    await admin
      .post(`/api/conversations/${body.id}/messages`)
      .set('Origin', origin)
      .send({ content: 'hello' })
      .expect(200);
    expect((await admin.get(`/api/conversations/${body.id}`)).body).toHaveLength(2);
  });
  it('keeps keys out of settings and scopes Gmail connections to the current user', async () => {
    const admin = await setup();
    const user = await member(admin);
    const { body } = await admin.get('/api/session');
    instance.ctx.store.run(
      'INSERT INTO connections VALUES(?,?,?)',
      body.user.id,
      'gmail',
      instance.ctx.vault.seal('{"refresh_token":"secret"}'),
    );
    expect((await admin.get('/api/integrations')).body[0].connected).toBe(true);
    expect((await user.get('/api/integrations')).body[0].connected).toBe(false);
    await user.delete('/api/integrations/gmail').set('Origin', origin).expect(200);
    expect((await admin.get('/api/integrations')).body[0].connected).toBe(true);
    const settings = await admin.get('/api/settings');
    expect(settings.body.hasApiKey).toBe(true);
    expect(JSON.stringify(settings.body)).not.toContain(account.apiKey);
    await admin
      .get('/api/integrations/gmail/callback?state=forged&code=bad')
      .expect(302)
      .expect('Location', '/integrations?error=oauth_state');
    await admin.post('/api/integrations/gmail/connect').set('Origin', origin).expect(400);
  });
});
it('rejects vault tampering and encrypts the same input differently', () => {
  const vault = new Vault(token());
  const a = vault.seal('secret');
  const b = vault.seal('secret');
  expect(a).not.toBe(b);
  expect(vault.open(a)).toBe('secret');
  const bytes = Buffer.from(a, 'base64');
  bytes[30] ^= 1;
  expect(() => vault.open(bytes.toString('base64'))).toThrow();
});

it('uses expiring session-bound OAuth state and PKCE, rejecting replay and wrong sessions', async () => {
  const { OAuth2Client } = await import('google-auth-library');
  const exchange = vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
    tokens: {
      access_token: 'access-test',
      refresh_token: 'refresh-test',
      scope: 'https://www.googleapis.com/auth/gmail.modify',
    },
    res: null,
  } as never);
  try {
    const admin = await setup();
    const user = await member(admin);
    instance.ctx.store.set('googleClientId', 'test-client.apps.googleusercontent.com');
    instance.ctx.store.set('googleClientSecret', instance.ctx.vault.seal('test-secret'));
    const begin = await admin
      .post('/api/integrations/gmail/connect')
      .set('Origin', origin)
      .expect(200);
    const url = new URL(begin.body.url);
    const state = url.searchParams.get('state')!;
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    await user
      .get(`/api/integrations/gmail/callback?state=${state}&code=test`)
      .expect('Location', '/integrations?error=oauth_state');
    expect(exchange).not.toHaveBeenCalled();
    await admin
      .get(`/api/integrations/gmail/callback?state=${state}&code=test`)
      .expect('Location', '/integrations?connected=gmail');
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][0]).toMatchObject({
      code: 'test',
      codeVerifier: expect.any(String),
    });
    await admin
      .get(`/api/integrations/gmail/callback?state=${state}&code=test`)
      .expect('Location', '/integrations?error=oauth_state');
    expect(exchange).toHaveBeenCalledTimes(1);
    const saved = instance.ctx.store.get<{ credentials: string }>(
      'SELECT credentials FROM connections',
    )!.credentials;
    expect(saved).not.toContain('refresh-test');
    const next = await admin.post('/api/integrations/gmail/connect').set('Origin', origin);
    const expired = new URL(next.body.url).searchParams.get('state');
    instance.ctx.store.run('UPDATE oauth_states SET expires_at=0');
    await admin
      .get(`/api/integrations/gmail/callback?state=${expired}&code=test`)
      .expect('Location', '/integrations?error=oauth_state');
  } finally {
    exchange.mockRestore();
  }
});

it('preserves users, sessions, conversations and secrets across restart', async () => {
  const admin = await setup();
  const session = await admin.get('/api/session');
  const conversation = await admin.post('/api/conversations').set('Origin', origin).send({});
  const encrypted = instance.ctx.store.setting('apiKey');
  instance.ctx.store.db.close();
  instance = createApp(config, runAgent);
  expect(
    instance.ctx.store.get('SELECT id FROM users WHERE id=?', session.body.user.id),
  ).toBeTruthy();
  expect(
    instance.ctx.store.get('SELECT id FROM conversations WHERE id=?', conversation.body.id),
  ).toBeTruthy();
  expect(instance.ctx.store.get('SELECT token FROM sessions')).toBeTruthy();
  expect(instance.ctx.vault.open(encrypted)).toBe(account.apiKey);
});

describe('integration settings', () => {
  it('saves Gmail OAuth independently, encrypts secrets and preserves a blank secret', async () => {
    const admin = await setup();
    const originalModel = instance.ctx.store.setting('model');
    const originalPrompt = instance.ctx.store.setting('systemPrompt');
    await admin
      .put('/api/integrations/gmail/settings')
      .set('Origin', origin)
      .send({ clientId: 'test.apps.googleusercontent.com', clientSecret: 'test-only-secret' })
      .expect(200);
    const encrypted = instance.ctx.store.setting('googleClientSecret');
    expect(encrypted).not.toContain('test-only-secret');
    expect(instance.ctx.vault.open(encrypted)).toBe('test-only-secret');
    const result = await admin.get('/api/integrations/gmail/settings').expect(200);
    expect(result.body).toEqual({
      clientId: 'test.apps.googleusercontent.com',
      hasClientSecret: true,
      callbackUrl: origin + '/api/integrations/gmail/callback',
    });
    expect(JSON.stringify(result.body)).not.toContain('test-only-secret');
    await admin
      .put('/api/integrations/gmail/settings')
      .set('Origin', origin)
      .send({ clientId: 'changed.apps.googleusercontent.com', clientSecret: '' })
      .expect(200);
    expect(instance.ctx.store.setting('googleClientSecret')).toBe(encrypted);
    expect(instance.ctx.store.setting('model')).toBe(originalModel);
    expect(instance.ctx.store.setting('systemPrompt')).toBe(originalPrompt);
    expect((await admin.get('/api/integrations')).body[0].configured).toBe(true);
    const general = (await admin.get('/api/settings')).body;
    expect(general).not.toHaveProperty('googleClientId');
    expect(general).not.toHaveProperty('hasGoogleSecret');
    await admin
      .put('/api/settings')
      .set('Origin', origin)
      .send({ model: 'another-model', systemPrompt: 'Another prompt', apiKey: '' })
      .expect(200);
    expect(instance.ctx.store.setting('googleClientId')).toBe('changed.apps.googleusercontent.com');
    expect(instance.ctx.store.setting('googleClientSecret')).toBe(encrypted);
  });
  it('enforces admin/origin checks and validates integration settings atomically', async () => {
    const admin = await setup(),
      user = await member(admin);
    await request(instance.app).get('/api/integrations/gmail/settings').expect(401);
    await user.get('/api/integrations/gmail/settings').expect(403);
    await user
      .put('/api/integrations/gmail/settings')
      .set('Origin', origin)
      .send({ clientId: 'wrong' })
      .expect(403);
    await admin
      .put('/api/integrations/gmail/settings')
      .set('Origin', 'https://other.example')
      .send({ clientId: 'wrong' })
      .expect(403);
    await admin
      .put('/api/integrations/gmail/settings')
      .set('Origin', origin)
      .send({ clientId: 'wrong', clientSecret: 'x'.repeat(501) })
      .expect(400);
    await admin
      .put('/api/integrations/gmail/settings')
      .set('Origin', origin)
      .send({ clientId: 'wrong', model: 'overwrite' })
      .expect(400);
    expect(instance.ctx.store.setting('googleClientId')).toBe('');
    expect(instance.ctx.store.setting('model')).toBe(account.model);
  });
  it('reports environment-configured credentials without exposing the secret', async () => {
    const admin = await setup();
    config.googleClientId = 'environment-client';
    config.googleClientSecret = 'environment-secret';
    const result = await admin.get('/api/integrations/gmail/settings').expect(200);
    expect(result.body.clientId).toBe('environment-client');
    expect(result.body.hasClientSecret).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain('environment-secret');
  });
});

describe('integration activation', () => {
  it('starts inactive, gates all entry points and keeps configuration only on explicit choice', async () => {
    expect(instance.ctx.store.setting('integration:gmail:enabled')).toBe('false');
    const admin = await setup();
    const user = await member(admin);
    const id = (await admin.get('/api/session')).body.user.id;
    instance.ctx.store.set('googleClientId', 'demo-id');
    instance.ctx.store.set('googleClientSecret', instance.ctx.vault.seal('demo-secret'));
    instance.ctx.store.run('INSERT INTO connections VALUES(?,?,?)', id, 'gmail', 'sealed');
    const before = instance.ctx.store.setting('googleClientSecret');
    await user
      .put('/api/integrations/gmail/activation')
      .set('Origin', origin)
      .send({ enabled: false, keepConfiguration: false })
      .expect(403);
    await admin
      .put('/api/integrations/gmail/activation')
      .set('Origin', origin)
      .send({ enabled: false })
      .expect(400);
    await admin
      .put('/api/integrations/gmail/activation')
      .send({ enabled: false, keepConfiguration: true })
      .expect(403);
    await admin
      .put('/api/integrations/gmail/activation')
      .set('Origin', origin)
      .send({ enabled: false, keepConfiguration: true })
      .expect(200);
    expect(instance.ctx.store.setting('googleClientSecret')).toBe(before);
    await admin.get('/api/integrations/gmail/settings').expect(409);
    await admin
      .put('/api/integrations/gmail/settings')
      .set('Origin', origin)
      .send({ clientId: 'replacement' })
      .expect(409);
    await admin.post('/api/integrations/gmail/connect').set('Origin', origin).expect(409);
    await admin.get('/api/integrations/gmail/callback?state=x&code=x').expect(409);
    const { connectedIntegrations } = await import('../server/integrations/registry.js');
    const { gmail } = await import('../server/integrations/gmail.js');
    expect(connectedIntegrations(instance.ctx, id)).toEqual([]);
    await expect(gmail.execute(instance.ctx, id, 'gmail_search', { query: 'x' })).rejects.toThrow(
      'aktivieren',
    );
    await admin
      .put('/api/integrations/gmail/activation')
      .set('Origin', origin)
      .send({ enabled: true })
      .expect(200);
    expect(connectedIntegrations(instance.ctx, id).map((i) => i.id)).toEqual(['gmail']);
    expect((await admin.get('/api/integrations')).body[0]).toMatchObject({
      enabled: true,
      configured: true,
      connected: true,
    });
  });
  it('deletes credentials and all connections and does not revive environment configuration', async () => {
    const admin = await setup();
    const user = await member(admin);
    config.googleClientId = 'env-id';
    config.googleClientSecret = 'env-secret';
    for (const session of [admin, user]) {
      const id = (await session.get('/api/session')).body.user.id;
      instance.ctx.store.run('INSERT INTO connections VALUES(?,?,?)', id, 'gmail', 'sealed');
    }
    instance.ctx.store.set('googleClientId', 'stored-id');
    instance.ctx.store.set('googleClientSecret', instance.ctx.vault.seal('stored-secret'));
    await admin
      .put('/api/integrations/gmail/activation')
      .set('Origin', origin)
      .send({ enabled: false, keepConfiguration: false })
      .expect(200);
    expect(instance.ctx.store.all('SELECT * FROM connections')).toEqual([]);
    expect(instance.ctx.store.setting('googleClientId')).toBe('');
    expect(instance.ctx.store.setting('googleClientSecret')).toBe('');
    const { initializeIntegrations } = await import('../server/integrations/routes.js');
    initializeIntegrations(instance.ctx);
    expect(instance.ctx.store.setting('integration:gmail:enabled')).toBe('false');
    await admin
      .put('/api/integrations/gmail/activation')
      .set('Origin', origin)
      .send({ enabled: true })
      .expect(200);
    expect((await admin.get('/api/integrations/gmail/settings')).body).toMatchObject({
      clientId: '',
      hasClientSecret: false,
    });
    expect((await admin.get('/api/integrations')).body[0].configured).toBe(false);
  });
  it('initializes existing installations once and preserves their credentials', async () => {
    const { initializeIntegrations } = await import('../server/integrations/routes.js');
    instance.ctx.store.run("DELETE FROM settings WHERE key='integration:gmail:enabled'");
    config.googleClientId = 'existing-id';
    config.googleClientSecret = 'existing-secret';
    initializeIntegrations(instance.ctx);
    expect(instance.ctx.store.setting('integration:gmail:enabled')).toBe('true');
    instance.ctx.store.set('integration:gmail:enabled', 'false');
    initializeIntegrations(instance.ctx);
    expect(instance.ctx.store.setting('integration:gmail:enabled')).toBe('false');
  });
});

it('does not restore a Gmail connection when an old OAuth exchange completes after deactivate/reactivate', async () => {
  const { OAuth2Client } = await import('google-auth-library');
  const { gmail } = await import('../server/integrations/gmail.js');
  const admin = await setup();
  instance.ctx.store.set('googleClientId', 'test-id');
  instance.ctx.store.set('googleClientSecret', instance.ctx.vault.seal('test-secret'));
  const begin = await admin
    .post('/api/integrations/gmail/connect')
    .set('Origin', origin)
    .expect(200);
  const state = new URL(begin.body.url).searchParams.get('state');
  const exchange = vi.spyOn(OAuth2Client.prototype, 'getToken').mockImplementation(async () => {
    instance.ctx.store.set('integration:gmail:enabled', 'false');
    gmail.deactivate!(instance.ctx);
    gmail.clearConfiguration(instance.ctx);
    instance.ctx.store.set('integration:gmail:enabled', 'true');
    return {
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        scope: 'https://www.googleapis.com/auth/gmail.modify',
      },
      res: null,
    } as never;
  });
  try {
    await admin
      .get(`/api/integrations/gmail/callback?state=${state}&code=test`)
      .expect('Location', '/integrations?error=oauth_changed');
    expect(instance.ctx.store.all('SELECT * FROM connections')).toEqual([]);
  } finally {
    exchange.mockRestore();
  }
});
