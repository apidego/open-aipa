import { z } from 'zod';
import type { Context } from '../../core/context.js';
import { clientFor, textParts, type MailPart } from '../../integrations/gmail-client.js';
export async function readMailboxMessage(ctx: Context, userId: string, value: unknown) {
  const id = z
    .string()
    .regex(/^[a-fA-F0-9]{1,100}$/)
    .parse(value);
  const client = await clientFor(ctx, userId);
  const { data } = await client.request<{
    snippet?: string;
    payload?: MailPart & { headers?: { name: string; value: string }[] };
  }>({
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
    params: { format: 'full' },
    timeout: 20000,
  });
  const header = (name: string) =>
    data.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || '';
  return {
    id,
    subject: header('subject'),
    from: header('from'),
    date: header('date'),
    text: (textParts(data.payload) || data.snippet || '').slice(0, 20000),
  };
}
export async function searchMailbox(ctx: Context, userId: string, value: unknown) {
  const query = z.string().max(500).parse(value);
  const client = await clientFor(ctx, userId);
  const { data } = await client.request<{ messages?: { id: string }[] }>({
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
    params: { q: query, maxResults: 10 },
    timeout: 20000,
  });
  return Promise.all(
    (data.messages || []).slice(0, 10).map(async (m) => {
      const { text, ...mail } = await readMailboxMessage(ctx, userId, m.id);
      return { ...mail, text: text.slice(0, 300) };
    }),
  );
}
