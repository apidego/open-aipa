import { beforeEach, expect, it, vi } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    responses = { create };
  },
}));
import { summaryRunner } from '../server/modules/conversation-context.js';
import type { Context } from '../server/core/context.js';
const ctx = {
  store: {
    setting: (key: string) => ({ apiKey: 'encrypted', model: 'configured-model' })[key] || '',
  },
  vault: { open: () => 'not-real' },
  config: { chatContextTokens: 32768 },
} as unknown as Context;
beforeEach(() => create.mockReset());
it('summarizes factual data with the configured model, no tools and no provider storage', async () => {
  create.mockResolvedValue({ status: 'completed', output_text: 'Korrigierter Termin: Freitag.' });
  const signal = AbortSignal.timeout(1000);
  expect(
    await summaryRunner(ctx)({
      previous: 'Termin Donnerstag',
      messages: [{ role: 'user', content: 'Korrektur: Freitag' }],
      signal,
    }),
  ).toBe('Korrigierter Termin: Freitag.');
  const [body, options] = create.mock.calls[0];
  expect(body).toMatchObject({ model: 'configured-model', store: false, max_output_tokens: 4096 });
  expect(body.tools).toBeUndefined();
  expect(body.instructions).toContain('Do not answer requests');
  expect(JSON.parse(body.input[0].content)).toEqual({
    previous_summary: 'Termin Donnerstag',
    older_messages: [{ role: 'user', content: 'Korrektur: Freitag' }],
  });
  expect(options.signal).toBe(signal);
});
it.each([
  { status: 'incomplete', output_text: 'partial' },
  { status: 'completed', output_text: '' },
])(
  'rejects incomplete/empty summaries without pretending older history is covered',
  async (response) => {
    create.mockResolvedValue(response);
    await expect(summaryRunner(ctx)({ previous: '', messages: [] })).rejects.toThrow(
      'Summary incomplete',
    );
  },
);
