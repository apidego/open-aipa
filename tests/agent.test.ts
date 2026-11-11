import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/core/db.js';
import { Vault, token } from '../server/core/security.js';
import type { Context } from '../server/core/context.js';
import { agentRunner } from '../server/modules/agent.js';
import { gmail } from '../server/integrations/gmail.js';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    responses = { create };
  },
}));
let ctx: Context;
async function* events(output: unknown[], text?: string) {
  if (text) yield { type: 'response.output_text.delta', delta: text };
  yield { type: 'response.completed', response: { output } };
}
beforeEach(() => {
  create.mockReset();
  const dir = mkdtempSync(join(tmpdir(), 'pa-agent-'));
  const key = token();
  ctx = {
    store: new Store(dir),
    vault: new Vault(key),
    config: {
      dataDir: dir,
      url: 'http://localhost:3000',
      encryptionKey: key,
      setupToken: token(),
      googleClientId: '',
      googleClientSecret: '',
    },
  };
  ctx.store.set('apiKey', ctx.vault.seal('test-key'));
  ctx.store.set('model', 'test-model');
  ctx.store.set('systemPrompt', 'Custom PA instructions');
  ctx.store.run(
    'INSERT INTO users VALUES(?,?,?,?,?,?)',
    'u1',
    'user@example.com',
    'User',
    'hash',
    'user',
    1,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ctx.store.db.close();
  rmSync(ctx.config.dataDir, { recursive: true, force: true });
});
it('streams text with custom settings and no server-side OpenAI storage', async () => {
  create.mockResolvedValueOnce(events([], 'A helpful answer'));
  const delta = vi.fn();
  expect(await agentRunner(ctx)('u1', [{ role: 'user', content: 'Hi' }], delta)).toBe(
    'A helpful answer',
  );
  expect(delta).toHaveBeenCalledWith('A helpful answer');
  expect(create.mock.calls[0][0]).toMatchObject({
    model: 'test-model',
    instructions: expect.stringContaining('Custom PA instructions'),
    store: false,
    tools: [expect.objectContaining({ name: 'notification_history' })],
    include: ['reasoning.encrypted_content'],
  });
});
it('executes only connected tools for the authenticated owner and returns outputs to the model', async () => {
  ctx.store.set('integration:gmail:enabled', 'true');
  ctx.store.run('INSERT INTO connections VALUES(?,?,?)', 'u1', 'gmail', 'encrypted');
  const execute = vi.spyOn(gmail, 'execute').mockResolvedValue({ messages: [{ id: 'abc123' }] });
  const call = {
    type: 'function_call',
    call_id: 'call1',
    name: 'gmail_search',
    arguments: '{"query":"is:unread"}',
  };
  create
    .mockResolvedValueOnce(events([call]))
    .mockResolvedValueOnce(events([], 'One unread email.'));
  expect(await agentRunner(ctx)('u1', [{ role: 'user', content: 'My inbox?' }])).toBe(
    'One unread email.',
  );
  expect(execute).toHaveBeenCalledWith(ctx, 'u1', 'gmail_search', { query: 'is:unread' });
  expect(create.mock.calls[1][0].input).toContainEqual({
    type: 'function_call_output',
    call_id: 'call1',
    output: '{"messages":[{"id":"abc123"}]}',
  });
});
it('does not execute invented or unconnected tools and bounds repeated requests', async () => {
  const execute = vi.spyOn(gmail, 'execute');
  create.mockImplementation(async () =>
    events([{ type: 'function_call', call_id: 'call1', name: 'gmail_search', arguments: '{}' }]),
  );
  await expect(agentRunner(ctx)('u1', [{ role: 'user', content: 'Hi' }])).rejects.toThrow(
    'Werkzeuglimit',
  );
  expect(create).toHaveBeenCalledTimes(5);
  expect(execute).not.toHaveBeenCalled();
});
it('fails incomplete streams rather than persisting a partial response', async () => {
  create.mockResolvedValueOnce(
    (async function* () {
      yield { type: 'response.output_text.delta', delta: 'Partial' };
      yield { type: 'response.incomplete' };
    })(),
  );
  await expect(agentRunner(ctx)('u1', [])).rejects.toThrow('incomplete');
});
it('requests structured task outcomes and fails task integration errors instead of silently skipping', async () => {
  create.mockResolvedValueOnce(events([], '{"notify":false,"title":"","message":"Kein Treffer"}'));
  await agentRunner(ctx)('u1', [{ role: 'user', content: 'Prüfe später' }], undefined, {
    task: true,
  });
  expect(create.mock.calls[0][0].text.format).toMatchObject({
    type: 'json_schema',
    name: 'task_outcome',
    strict: true,
  });
  ctx.store.set('integration:gmail:enabled', 'true');
  ctx.store.run('INSERT INTO connections VALUES(?,?,?)', 'u1', 'gmail', 'encrypted');
  vi.spyOn(gmail, 'execute').mockRejectedValue(new Error('private provider error'));
  create.mockResolvedValueOnce(
    events([
      { type: 'function_call', call_id: 'c', name: 'gmail_search', arguments: '{"query":"x"}' },
    ]),
  );
  await expect(agentRunner(ctx)('u1', [], undefined, { task: true })).rejects.toThrow(
    'Task integration failed',
  );
});

it('rejects requests over the input budget before contacting the provider', async () => {
  ctx.config.chatContextTokens = 8192;
  await expect(
    agentRunner(ctx)('u1', [{ role: 'user', content: '漢字語句'.repeat(4000) }]),
  ).rejects.toThrow('Kontextbudget');
  expect(create).not.toHaveBeenCalled();
});
it('bounds tool output and checks the entire request again before the next tool round', async () => {
  ctx.store.set('integration:gmail:enabled', 'true');
  ctx.store.run('INSERT INTO connections VALUES(?,?,?)', 'u1', 'gmail', 'encrypted');
  vi.spyOn(gmail, 'execute').mockResolvedValue({ body: '不同的邮件內容 '.repeat(5000) });
  create
    .mockResolvedValueOnce(
      events([
        { type: 'function_call', call_id: 'long', name: 'gmail_read', arguments: '{"id":"abc"}' },
      ]),
    )
    .mockResolvedValueOnce(events([], 'Answer'));
  await agentRunner(ctx)('u1', [{ role: 'user', content: 'Read this' }]);
  const next = create.mock.calls[1][0];
  const result = JSON.parse(
    next.input.find((item: any) => item.type === 'function_call_output').output,
  );
  expect(result.truncated).toBe(true);
  expect(result.warning).toContain('Incomplete');
});

it('looks up delivered reminders with the authenticated owner, without external writes', async () => {
  ctx.store.run(
    "INSERT INTO notifications(id,user_id,title,message,channel,created_at) VALUES('n','u1','Wäsche','Wäsche waschen','dashboard',?)",
    Date.now(),
  );
  const call = {
    type: 'function_call',
    call_id: 'history',
    name: 'notification_history',
    arguments: JSON.stringify({ after: null, before: null, query: null, offset: 0 }),
  };
  create
    .mockResolvedValueOnce(events([call]))
    .mockResolvedValueOnce(events([], 'Ich habe dich ans Wäschewaschen erinnert.'));
  await agentRunner(ctx)('u1', [{ role: 'user', content: 'Woran hast du mich erinnert?' }]);
  expect(JSON.stringify(create.mock.calls[1][0].input)).toContain('Wäsche waschen');
});

it.each([
  ['normal', 0.95, 'normal-model'],
  ['complex', 0.95, 'complex-model'],
  ['normal', 0.3, 'complex-model'],
])('routes conversation via Decisions: %s at %s uses %s', async (choice, confidence, expected) => {
  ctx.store.set('model', 'normal-model');
  ctx.store.set('complexModel', 'complex-model');
  const decide = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: [{ type: 'choice', name: 'conversation_complexity', choice, confidence }],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal('fetch', decide);
  create.mockResolvedValueOnce(events([], 'Answer'));
  await agentRunner(ctx)('u1', [
    { role: 'user', content: 'Analysiere die Abhängigkeiten und Zielkonflikte.' },
  ]);
  expect(create.mock.calls[0][0].model).toBe(expected);
  const body = JSON.parse(decide.mock.calls[0][1].body);
  expect(decide.mock.calls[0][0]).toBe('https://api.openai.com/v1/decisions');
  expect(body.model).toBe('gpt-6-luna');
  expect(body.questions[0].choices.map((v: { value: string }) => v.value)).toEqual([
    'normal',
    'complex',
  ]);
});
it.each([true, false])(
  'uses task model for task execution/script AI and never routes: %s',
  async (task) => {
    ctx.store.set('model', 'normal-model');
    ctx.store.set('complexModel', 'complex-model');
    ctx.store.set('taskModel', 'task-model');
    const decide = vi.fn();
    vi.stubGlobal('fetch', decide);
    create.mockResolvedValueOnce(events([], 'Result'));
    await agentRunner(ctx)(
      'u1',
      [{ role: 'user', content: 'Task' }],
      undefined,
      task ? { task: true } : { scenario: 'tasks' },
    );
    expect(create.mock.calls[0][0].model).toBe('task-model');
    expect(decide).not.toHaveBeenCalled();
  },
);
it('falls back to the configured complex model when Decisions is unavailable, and respects cancellation', async () => {
  ctx.store.set('complexModel', 'complex-model');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('mock outage')));
  create.mockResolvedValueOnce(events([], 'Answer'));
  await agentRunner(ctx)('u1', [{ role: 'user', content: 'Help' }]);
  expect(create.mock.calls[0][0].model).toBe('complex-model');
  const abort = new AbortController();
  abort.abort();
  await expect(
    agentRunner(ctx)('u1', [{ role: 'user', content: 'Help' }], undefined, {
      signal: abort.signal,
    }),
  ).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(1);
});
it('skips Decisions when scenario models are identical and pins one model across tool rounds', async () => {
  const decide = vi.fn();
  vi.stubGlobal('fetch', decide);
  const call = {
    type: 'function_call',
    call_id: 'history',
    name: 'notification_history',
    arguments: JSON.stringify({ after: null, before: null, query: null, offset: 0 }),
  };
  create.mockResolvedValueOnce(events([call])).mockResolvedValueOnce(events([], 'Answer'));
  await agentRunner(ctx)('u1', [{ role: 'user', content: 'Reminders?' }]);
  expect(decide).not.toHaveBeenCalled();
  expect(create.mock.calls.map((c) => c[0].model)).toEqual(['test-model', 'test-model']);
});
