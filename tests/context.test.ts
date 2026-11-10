import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { token } from '../server/core/security.js';
import { conversationContext } from '../server/modules/conversation-context.js';
import {
  requestTokens,
  inputBudget,
  textTokens,
  SUMMARY_TOKENS,
  boundedToolResult,
} from '../server/modules/context-budget.js';
import { discordMessages } from '../server/integrations/discord-channel.js';
let app: ReturnType<typeof createApp>;
const run = vi.fn(async () => 'Antwort');
const summarize = vi.fn(
  async () => 'Projekt Atlas: Nutzer möchte Freitag um 10 Uhr starten. Offene Frage: Budget.',
);
beforeEach(() => {
  run.mockReset().mockResolvedValue('Antwort');
  summarize.mockClear();
  app = createApp(
    {
      url: 'http://localhost:3000',
      dataDir: mkdtempSync(join(tmpdir(), 'pa-context-')),
      encryptionKey: token(),
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
    run,
    undefined,
    summarize,
  );
  for (const id of ['u1', 'u2'])
    app.ctx.store.run(
      'INSERT INTO users VALUES(?,?,?,?,?,?)',
      id,
      id + '@example.test',
      id,
      'hash',
      'user',
      1,
    );
  app.ctx.store.run("INSERT INTO conversations VALUES('c','u1','Chat',1)");
});
afterEach(() => {
  app.ctx.store.db.close();
  rmSync(app.ctx.config.dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function history(turns: number, id = 'c', long = false) {
  for (let i = 0; i < turns; i++)
    for (const role of ['user', 'assistant'])
      app.ctx.store.run(
        'INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)',
        id,
        role,
        `${role} ${i}: ` +
          (long
            ? 'ein konkretes Gespräch mit vielen Details '.repeat(200)
            : 'Projekt Atlas und Freitag um 10 Uhr.'),
        i,
      );
}
it('keeps recent complete exchanges and current request verbatim with reusable older memory', async () => {
  history(60);
  const prepare = conversationContext(app.ctx, summarize);
  const result = await prepare('u1', 'c', 'Neue Frage');
  expect(summarize).toHaveBeenCalledOnce();
  expect(summarize.mock.calls[0][0].messages).toHaveLength(60);
  expect(result.messages).toHaveLength(62);
  expect(result.messages[1].content).toContain('user 30:');
  expect(result.messages.at(-1)).toEqual({ role: 'user', content: 'Neue Frage' });
  expect(result.messages[0].content).toContain('Projekt Atlas');
  expect(result.notice).toBeNull();
  expect(app.ctx.store.all('SELECT * FROM messages')).toHaveLength(120);
  await prepare('u1', 'c', 'Neue Frage');
  expect(summarize).toHaveBeenCalledOnce();
  expect(requestTokens('', result.messages)).toBeLessThan(inputBudget(app.ctx));
});
it('uses token budgets before the message cap and bounds each summary batch and catch-up work', async () => {
  history(120, 'c', true);
  const result = await conversationContext(app.ctx, summarize)('u1', 'c', 'Aktuelle Frage');
  expect(summarize.mock.calls.length).toBeLessThanOrEqual(2);
  expect(summarize.mock.calls.length).toBeGreaterThan(0);
  expect(result.messages.length).toBeLessThan(82);
  expect(result.messages.at(-2)?.role).toBe('assistant');
  expect(result.messages.at(-1)?.content).toBe('Aktuelle Frage');
  expect(requestTokens('', result.messages)).toBeLessThan(inputBudget(app.ctx));
  expect(result.notice).not.toBeNull();
  const cursor = app.ctx.store.get<{ through_id: number }>(
    'SELECT through_id FROM conversation_context',
  )!.through_id;
  expect(cursor).toBeLessThan(
    app.ctx.store.get<{ id: number }>('SELECT MAX(id) id FROM messages')!.id,
  );
});
it('does not advance past failed summaries, backs off, and makes missing context explicit', async () => {
  history(45);
  const fail = vi.fn(async () => {
    throw new Error('private provider detail');
  });
  const prepare = conversationContext(app.ctx, fail);
  const result = await prepare('u1', 'c', 'Frage');
  expect(result.notice).toContain('teilweise');
  expect(JSON.stringify(result)).not.toContain('private provider detail');
  expect(app.ctx.store.get('SELECT through_id,summary FROM conversation_context')).toEqual({
    through_id: 0,
    summary: '',
  });
  await prepare('u1', 'c', 'Andere Frage');
  expect(fail).toHaveBeenCalledOnce();
});
it('cannot read another user or revive deleted conversations during summarization', async () => {
  history(45);
  const prepare = conversationContext(app.ctx, summarize);
  await expect(prepare('u2', 'c', 'x')).rejects.toThrow('nicht gefunden');
  expect(summarize).not.toHaveBeenCalled();
  const deleting = conversationContext(app.ctx, async () => {
    app.ctx.store.run("DELETE FROM conversations WHERE id='c'");
    return 'summary';
  });
  await expect(deleting('u1', 'c', 'x')).rejects.toThrow('nicht gefunden');
  expect(app.ctx.store.all('SELECT * FROM conversation_context')).toEqual([]);
});
it('keeps memory isolated and cascades deletion without altering original messages', async () => {
  history(45);
  await conversationContext(app.ctx, summarize)('u1', 'c', 'Frage');
  app.ctx.store.run("INSERT INTO conversations VALUES('new','u1','New',1)");
  const fresh = await conversationContext(app.ctx, summarize)('u1', 'new', 'Hallo');
  expect(fresh.messages).toEqual([{ role: 'user', content: 'Hallo' }]);
  app.ctx.store.run("DELETE FROM conversations WHERE id='c'");
  expect(app.ctx.store.all('SELECT * FROM conversation_context')).toEqual([]);
});
it('marks clipped source/summary information and rejects an oversized current request unchanged', async () => {
  history(41);
  const huge = vi.fn(async () => 'Viele unterschiedliche Einzelheiten. '.repeat(3000));
  const result = await conversationContext(app.ctx, huge)('u1', 'c', 'Frage');
  expect(result.notice).not.toBeNull();
  expect(
    textTokens(
      app.ctx.store.get<{ summary: string }>('SELECT summary FROM conversation_context')!.summary,
    ),
  ).toBeLessThanOrEqual(SUMMARY_TOKENS);
  app.ctx.config.chatContextTokens = 8192;
  await expect(
    conversationContext(app.ctx, summarize)('u1', 'c', '漢字語句'.repeat(4000)),
  ).rejects.toThrow('zu lang');
});
it('bounds long tool payloads and labels excerpts rather than pretending they are complete', () => {
  const result = JSON.parse(boundedToolResult({ body: '不同的邮件內容 '.repeat(5000) }));
  expect(result.truncated).toBe(true);
  expect(result.warning).toContain('Incomplete');
  expect(textTokens(result.excerpt)).toBeLessThanOrEqual(5000);
  expect(boundedToolResult({ id: 'abc' })).toBe('{"id":"abc"}');
});
it('passes identical prepared context through dashboard and Discord entry points', async () => {
  app.ctx.store.run('DELETE FROM users');
  const admin = request.agent(app.app);
  await admin
    .post('/api/setup')
    .set('Origin', 'http://localhost:3000')
    .send({
      setupToken: app.ctx.config.setupToken,
      name: 'Admin',
      email: 'admin@example.test',
      password: 'long-test-password',
      apiKey: 'sk-test-not-real',
      model: 'test',
    })
    .expect(201);
  const user = (await admin.get('/api/session')).body.user.id;
  for (const id of ['web', 'dm']) {
    app.ctx.store.run('INSERT INTO conversations VALUES(?,?,?,?)', id, user, 'Chat', 1);
    history(45, id);
  }
  await admin
    .post('/api/conversations/web/messages')
    .set('Origin', 'http://localhost:3000')
    .send({ content: 'Dieselbe Frage' })
    .expect(200);
  app.ctx.store.set('integration:discord:enabled', 'true');
  app.ctx.store.set('discordBotToken', app.ctx.vault.seal('test'));
  app.ctx.store.run(
    'INSERT INTO discord_links VALUES(?,?,?,?,?)',
    'link',
    user,
    '111111111111111111',
    '222222222222222222',
    'dm',
  );
  await discordMessages(
    app.ctx,
    run,
    async () => {},
    () => true,
    conversationContext(app.ctx, summarize),
  )({
    id: '333333333333333333',
    userId: '111111111111111111',
    channelId: '222222222222222222',
    content: 'Dieselbe Frage',
    createdAt: Date.now(),
    direct: true,
    bot: false,
    webhook: false,
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0][0]).toBe(user);
  expect(run.mock.calls[1][0]).toBe(user);
  expect(run.mock.calls[1][1]).toEqual(run.mock.calls[0][1]);
});
