import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/core/db.js';
import { Vault, token } from '../server/core/security.js';
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
  ctx.store.db.close();
  rmSync(ctx.config.dataDir, { recursive: true, force: true });
});
it('generates structured plans with configured model, time context, script contract and only connected tools', async () => {
  ctx.store.run('INSERT INTO connections VALUES(?,?,?)', 'u', 'gmail', 'encrypted');
  parse.mockResolvedValue({
    status: 'completed',
    output_parsed: { clarification: 'Welche Uhrzeit?' },
  });
  await jobPlanner(ctx)('u', 'automation', 'Prüfe Gmail', 'Europe/Berlin', false);
  expect(parse.mock.calls[0][0]).toMatchObject({
    model: 'configured-model',
    store: false,
    text: { format: { type: 'json_schema', name: 'scheduled_job_plan', strict: true } },
  });
  expect(parse.mock.calls[0][0].instructions).toContain('gmail_search');
  expect(parse.mock.calls[0][0].instructions).toContain('AI permission: false');
  expect(parse.mock.calls[0][0].instructions).toContain('User timezone: Europe/Berlin');
  expect(parse.mock.calls[0][0].tools).toBeUndefined();
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
