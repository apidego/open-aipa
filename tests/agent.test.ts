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
    instructions: 'Custom PA instructions',
    store: false,
    tools: [],
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
