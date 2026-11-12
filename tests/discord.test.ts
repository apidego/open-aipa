import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { digest, token } from '../server/core/security.js';
import { discordMessages, type DirectMessage } from '../server/integrations/discord-channel.js';
import {
  discordRuntime,
  type DiscordTransportFactory,
} from '../server/integrations/discord-runtime.js';
import { discord } from '../server/integrations/discord.js';
import { conversationLocks } from '../server/modules/conversation-locks.js';
let app: ReturnType<typeof createApp>;
let seq: bigint;
const origin = 'http://localhost:3000';
const userId = '111111111111111111',
  channelId = '222222222222222222';
const run = vi.fn(async () => 'Hallo!');
const send = vi.fn(async () => {});
const msg = (content = 'Hallo', extra: Partial<DirectMessage> = {}): DirectMessage => ({
  id: String(seq++),
  userId,
  channelId,
  content,
  createdAt: Date.now(),
  direct: true,
  bot: false,
  webhook: false,
  ...extra,
});
beforeEach(() => {
  run.mockReset().mockResolvedValue('Hallo!');
  send.mockClear();
  seq = 300000000000000000n;
  app = createApp(
    {
      url: origin,
      dataDir: mkdtempSync(join(tmpdir(), 'pa-discord-')),
      encryptionKey: token(),
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
    run,
  );
  for (const id of ['u1', 'u2'])
    app.ctx.store.run(
      'INSERT INTO users VALUES(?,?,?,?,?,?)',
      id,
      id + '@example.test',
      id,
      'hash',
      'user',
      Date.now(),
    );
  app.ctx.store.set('integration:discord:enabled', 'true');
  app.ctx.store.set('discordBotToken', app.ctx.vault.seal('test-bot-token'));
});
afterEach(async () => {
  await app.discord.stop();
  app.ctx.store.db.close();
  rmSync(app.ctx.config.dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pair(id = 'u1', code = 'a'.repeat(32), expires = Date.now() + 600000) {
  app.ctx.store.run('INSERT INTO discord_pairings VALUES(?,?,?)', digest(code), id, expires);
  return code;
}
async function linked() {
  const handle = discordMessages(app.ctx, run, send);
  await handle(msg('!verbinden ' + pair()));
  send.mockClear();
  return handle;
}
it('links one-time codes and keeps account identity, context and messages user-scoped', async () => {
  const handle = await linked();
  expect(app.ctx.store.all('SELECT * FROM discord_pairings')).toEqual([]);
  await handle(msg('Erste Frage'));
  await handle(msg('Nachfrage'));
  expect(run).toHaveBeenNthCalledWith(
    1,
    'u1',
    [{ role: 'user', content: 'Erste Frage' }],
    undefined,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(run.mock.calls[1][1]).toEqual([
    { role: 'user', content: 'Erste Frage' },
    { role: 'assistant', content: 'Hallo!' },
    { role: 'user', content: 'Nachfrage' },
  ]);
  expect(app.ctx.store.all("SELECT * FROM conversations WHERE user_id='u1'")).toHaveLength(1);
  expect(app.ctx.store.all("SELECT * FROM conversations WHERE user_id='u2'")).toHaveLength(0);
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(4);
  expect(send.mock.calls.every((c) => c[0] === channelId)).toBe(true);
  await handle(msg('!neu'));
  await handle(msg('Neustart'));
  expect(run.mock.calls[2][1]).toEqual([{ role: 'user', content: 'Neustart' }]);
});
it('rejects expired/replayed codes and cannot steal an existing Discord identity', async () => {
  const handle = await linked();
  pair('u2', 'b'.repeat(32));
  await handle(msg('!verbinden ' + 'b'.repeat(32)));
  expect(app.ctx.store.all('SELECT user_id FROM discord_links')).toEqual([{ user_id: 'u1' }]);
  await handle(msg('!verbinden ' + 'a'.repeat(32), { userId: '444444444444444444' }));
  app.ctx.store.run('DELETE FROM discord_pairings');
  pair('u2', 'c'.repeat(32), Date.now() - 1);
  await handle(msg('!verbinden ' + 'c'.repeat(32), { userId: '444444444444444444' }));
  expect(app.ctx.store.all('SELECT * FROM discord_links')).toHaveLength(1);
  expect(run).not.toHaveBeenCalled();
});
it('ignores guilds, bots, webhooks, stale events and unknown users without invoking AI', async () => {
  const handle = await linked();
  for (const extra of [
    { direct: false },
    { bot: true },
    { webhook: true },
    { createdAt: Date.now() - 700000 },
    { userId: '444444444444444444' },
    { channelId: '555555555555555555' },
  ])
    await handle(msg('secret', extra));
  expect(run).not.toHaveBeenCalled();
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(0);
});
it('deduplicates messages across handler restarts and bounds reply chunks and rate', async () => {
  const handle = await linked();
  run.mockResolvedValue('x'.repeat(20000));
  const event = msg();
  await handle(event);
  await discordMessages(app.ctx, run, send)(event);
  expect(run).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(10);
  expect(send.mock.calls.every((c) => c[1].length <= 1900)).toBe(true);
  for (let i = 0; i < 20; i++) await handle(msg());
  expect(run.mock.calls.length).toBeLessThanOrEqual(10);
});
it('suppresses in-flight persistence and replies after disconnect or deactivation', async () => {
  const handle = await linked();
  let finish!: (s: string) => void;
  run.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = handle(msg('private'));
  await Promise.resolve();
  await handle(msg('!trennen'));
  send.mockClear();
  finish('private answer');
  await pending;
  expect(send).not.toHaveBeenCalled();
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(0);
  app.ctx.store.run('DELETE FROM discord_pairings');
  await handle(msg('!verbinden ' + pair()));
  const next = handle(msg('private again'));
  await Promise.resolve();
  app.ctx.store.set('integration:discord:enabled', 'false');
  discord.deactivate!(app.ctx);
  send.mockClear();
  finish('answer');
  await next;
  expect(send).not.toHaveBeenCalled();
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(0);
});
it('serializes turns and shares dashboard locks; failed AI does not persist an exchange', async () => {
  const handle = await linked();
  let finish!: (s: string) => void;
  run.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const pending = handle(msg());
  await Promise.resolve();
  await handle(msg('second'));
  expect(run).toHaveBeenCalledTimes(1);
  const conversation = app.ctx.store.get<{ id: string }>('SELECT id FROM conversations')!.id;
  expect(conversationLocks(app.ctx).has(conversation)).toBe(true);
  finish('done');
  await pending;
  expect(conversationLocks(app.ctx).has(conversation)).toBe(false);
  run.mockRejectedValue(new Error('SECRET'));
  await handle(msg('fail'));
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(2);
  expect(JSON.stringify(send.mock.calls)).not.toContain('SECRET');
  conversationLocks(app.ctx).add(conversation);
  await handle(msg('dashboard busy'));
  expect(run).toHaveBeenCalledTimes(2);
});
it('keeps configuration while inactive and removes bindings when deleted', async () => {
  const handle = await linked();
  const encrypted = app.ctx.store.setting('discordBotToken');
  app.ctx.store.set('integration:discord:enabled', 'false');
  discord.deactivate!(app.ctx);
  await handle(msg());
  expect(run).not.toHaveBeenCalled();
  expect(app.ctx.store.setting('discordBotToken')).toBe(encrypted);
  expect(app.ctx.store.all('SELECT * FROM discord_links')).toHaveLength(1);
  discord.clearConfiguration(app.ctx);
  expect(app.ctx.store.all('SELECT * FROM discord_links')).toEqual([]);
  expect(discord.configured(app.ctx)).toBe(false);
});
it('starts and stops the Gateway based on activation and replaces transport on token changes', async () => {
  const transports: {
    login: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    ready: () => boolean;
    send: typeof send;
  }[] = [];
  const factory: DiscordTransportFactory = () => {
    const t = {
      login: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      ready: () => true,
      send,
    };
    transports.push(t);
    return t;
  };
  const runtime = discordRuntime(app.ctx, run, factory);
  await runtime.sync();
  expect(transports[0].login).toHaveBeenCalledWith('test-bot-token');
  expect(runtime.status().state).toBe('online');
  await runtime.sync();
  expect(transports).toHaveLength(1);
  app.ctx.store.set('integration:discord:enabled', 'false');
  await runtime.sync();
  expect(transports[0].destroy).toHaveBeenCalledOnce();
  expect(runtime.status().state).toBe('offline');
  app.ctx.store.set('integration:discord:enabled', 'true');
  await runtime.sync();
  expect(transports).toHaveLength(2);
  await runtime.stop();
  expect(transports[1].destroy).toHaveBeenCalledOnce();
});
it('exposes admin-only encrypted bot setup and user-scoped pairing/revocation', async () => {
  app.ctx.store.run('DELETE FROM users');
  const admin = request.agent(app.app);
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
  await request(app.app).get('/api/integrations/discord/settings').expect(401);
  await user
    .put('/api/integrations/discord/settings')
    .set('Origin', origin)
    .send({ botToken: 'private' })
    .expect(403);
  await admin.put('/api/integrations/discord/settings').send({ botToken: 'private' }).expect(403);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: '666666666666666666', username: 'Demo Bot', bot: true }),
          { status: 200 },
        ),
    ),
  );
  await admin
    .put('/api/integrations/discord/settings')
    .set('Origin', origin)
    .send({ botToken: 'private-token' })
    .expect(200);
  expect(app.ctx.store.setting('discordBotToken')).not.toContain('private-token');
  expect(app.ctx.vault.open(app.ctx.store.setting('discordBotToken'))).toBe('private-token');
  const settings = await user.get('/api/integrations/discord/settings').expect(200);
  expect(JSON.stringify(settings.body)).not.toContain('private-token');
  const code = (
    await user.post('/api/integrations/discord/pairing').set('Origin', origin).send({}).expect(200)
  ).body.code;
  expect(app.ctx.store.all('SELECT code_hash FROM discord_pairings')).toEqual([
    { code_hash: digest(code) },
  ]);
  await admin.delete('/api/integrations/discord/pairing').set('Origin', origin).expect(200);
  expect(app.ctx.store.all('SELECT * FROM discord_pairings')).toHaveLength(1);
  await user.delete('/api/integrations/discord/pairing').set('Origin', origin).expect(200);
  expect(app.ctx.store.all('SELECT * FROM discord_pairings')).toHaveLength(0);
  await admin
    .put('/api/integrations/discord/activation')
    .set('Origin', origin)
    .send({ enabled: false, keepConfiguration: false })
    .expect(200);
  await user.post('/api/integrations/discord/pairing').set('Origin', origin).send({}).expect(409);
  await admin.get('/api/integrations/discord/settings').expect(409);
});

it('can disable a pending Gateway login and ignores its late completion', async () => {
  let finish!: () => void;
  const destroy = vi.fn(async () => {});
  const runtime = discordRuntime(app.ctx, run, () => ({
    login: () =>
      new Promise<void>((r) => {
        finish = r;
      }),
    destroy,
    ready: () => false,
    send,
  }));
  await runtime.sync();
  expect(runtime.status().state).toBe('connecting');
  app.ctx.store.set('integration:discord:enabled', 'false');
  await runtime.sync();
  expect(destroy).toHaveBeenCalledOnce();
  finish();
  await Promise.resolve();
  expect(runtime.status().state).toBe('offline');
  await runtime.stop();
});
it('does not spin on failed Gateway logins', async () => {
  const login = vi.fn(async () => {
    throw new Error('private credential detail');
  });
  const runtime = discordRuntime(app.ctx, run, () => ({
    login,
    destroy: vi.fn(async () => {}),
    ready: () => false,
    send,
  }));
  await runtime.sync();
  await Promise.resolve();
  await runtime.sync();
  expect(login).toHaveBeenCalledOnce();
  expect(runtime.status().state).toBe('error');
  await runtime.stop();
});
it('does not save a bot token after concurrent deactivation during validation', async () => {
  app.ctx.store.run('DELETE FROM users');
  const admin = request.agent(app.app);
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
  const stored = app.ctx.store.setting('discordBotToken');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      app.ctx.store.set('integration:discord:enabled', 'false');
      discord.deactivate!(app.ctx);
      return new Response(
        JSON.stringify({ id: '666666666666666666', username: 'Demo Bot', bot: true }),
      );
    }),
  );
  await admin
    .put('/api/integrations/discord/settings')
    .set('Origin', origin)
    .send({ botToken: 'replacement' })
    .expect(409);
  expect(app.ctx.store.setting('discordBotToken')).toBe(stored);
});

it('aborts agent work when the personal binding is revoked', async () => {
  vi.useFakeTimers();
  try {
    const handle = await linked();
    let signal: AbortSignal | undefined;
    run.mockImplementation(
      async (_user, _messages, _delta, options) =>
        new Promise<string>((_resolve, reject) => {
          signal = options?.signal;
          signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const pending = handle(msg('work'));
    await Promise.resolve();
    await handle(msg('!trennen'));
    await vi.advanceTimersByTimeAsync(300);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
it('migrates an existing v2 store without changing users or conversation history', async () => {
  const { Store } = await import('../server/core/db.js');
  app.ctx.store.run("INSERT INTO conversations VALUES('old','u1','Existing',1)");
  app.ctx.store.run(
    "INSERT INTO messages(conversation_id,role,content,created_at) VALUES('old','user','Existing text',1)",
  );
  app.ctx.store.db.exec(
    'DROP TABLE discord_pairings; DROP TABLE discord_links; DROP TABLE discord_receipts; DELETE FROM migrations WHERE version=3;',
  );
  app.ctx.store.db.close();
  app.ctx.store = new Store(app.ctx.config.dataDir);
  expect(app.ctx.store.get('SELECT version FROM migrations WHERE version=3')).toEqual({
    version: 3,
  });
  expect(app.ctx.store.all('SELECT * FROM discord_links')).toEqual([]);
  expect(app.ctx.store.get('SELECT content FROM messages')).toEqual({ content: 'Existing text' });
  expect(app.ctx.store.all('SELECT * FROM users')).toHaveLength(2);
  app.ctx.store.db.close();
  app.ctx.store = new Store(app.ctx.config.dataDir);
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(1);
});
it('reads only bot history from the authenticated owner’s bound DM with pagination', async () => {
  await linked();
  app.ctx.store.set('discordBotId', '555555555555555555');
  const rows = [
    {
      id: '666666666666666666',
      author: { id: userId },
      timestamp: '2026-11-11T09:00:00Z',
      content: '!verbinden secret',
    },
    {
      id: '666666666666666665',
      author: { id: '555555555555555555' },
      timestamp: '2026-11-11T08:00:00Z',
      content: 'Erinnerung: Wäsche waschen.',
    },
  ];
  const fetcher = vi.fn(async () => new Response(JSON.stringify(rows)));
  vi.stubGlobal('fetch', fetcher);
  const result = await discord.execute(app.ctx, 'u1', 'discord_read_history', {
    before: null,
    limit: 2,
  });
  expect(result).toEqual({
    messages: [{ id: rows[1].id, sent_at: rows[1].timestamp, message: rows[1].content }],
    next_before: rows[1].id,
  });
  expect(String(fetcher.mock.calls[0][0])).toBe(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=2`,
  );
  await discord.execute(app.ctx, 'u1', 'discord_read_history', { before: rows[1].id, limit: 2 });
  expect(String(fetcher.mock.calls[1][0])).toContain(`before=${rows[1].id}`);
  await expect(
    discord.execute(app.ctx, 'u2', 'discord_read_history', { before: null, limit: 2 }),
  ).rejects.toThrow('disconnected');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects arbitrary destinations, disabled integrations and stale in-flight history', async () => {
  await linked();
  app.ctx.store.set('discordBotId', '555555555555555555');
  const fetcher = vi.fn(async () => {
    app.ctx.store.run('DELETE FROM discord_links WHERE user_id=?', 'u1');
    return new Response('[]');
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(
    discord.execute(app.ctx, 'u1', 'discord_read_history', {
      before: null,
      limit: 20,
      channel_id: channelId,
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    discord.execute(app.ctx, 'u1', 'discord_read_history', { before: null, limit: 20 }),
  ).rejects.toThrow('disconnected');
  app.ctx.store.set('integration:discord:enabled', 'false');
  await expect(
    discord.execute(app.ctx, 'u1', 'discord_read_history', { before: null, limit: 20 }),
  ).rejects.toThrow('aktivieren');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('sanitizes Discord API failures instead of exposing remote details', async () => {
  await linked();
  app.ctx.store.set('discordBotId', '555555555555555555');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('sensitive remote details', { status: 403 })),
  );
  await expect(
    discord.execute(app.ctx, 'u1', 'discord_read_history', { before: null, limit: 20 }),
  ).rejects.toThrow('Discord history unavailable');
});
