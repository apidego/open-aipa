import { z } from 'zod';
import type { FunctionTool } from 'openai/resources/responses/responses';
import type { Context } from '../core/context.js';
import { clipText } from './context-budget.js';
export const notificationHistoryTool: FunctionTool = {
  type: 'function',
  name: 'notification_history',
  strict: true,
  description:
    'Read this user’s previously delivered reminders/notifications, including Discord DMs. Use when asked what you reminded them about or sent earlier. No sending. Dates are ISO timestamps with offsets; null means unrestricted. Returns newest first, 10 records per page, with creation time (not exact delivery time), task timezone and confirmed channels. Message excerpts may be truncated; narrow date/text filters if needed.',
  parameters: {
    type: 'object',
    properties: {
      after: {
        type: ['string', 'null'],
        description: 'Inclusive ISO creation timestamp with timezone.',
      },
      before: {
        type: ['string', 'null'],
        description: 'Exclusive ISO creation timestamp with timezone.',
      },
      query: { type: ['string', 'null'], description: 'Literal text to search in title/message.' },
      offset: { type: 'integer', minimum: 0, maximum: 1000 },
    },
    required: ['after', 'before', 'query', 'offset'],
    additionalProperties: false,
  },
};
export function notificationHistory(ctx: Context, userId: string, args: unknown) {
  const date = z.string().datetime({ offset: true }).nullable();
  const { after, before, query, offset } = z
    .object({
      after: date,
      before: date,
      query: z.string().max(200).nullable(),
      offset: z.number().int().min(0).max(1000),
    })
    .strict()
    .parse(args);
  const start = after ? Date.parse(after) : 0,
    end = before ? Date.parse(before) : 8640000000000000;
  if (start >= end) throw new Error('Invalid date range');
  const rows = ctx.store.all<{
    title: string;
    message: string;
    created_at: number;
    timezone: string | null;
    channels: string;
  }>(
    `
    WITH delivered AS (
      SELECT COALESCE(n.run_id,n.id) record_key,n.title,n.message,n.created_at,
        json_extract(j.schedule,'$.timezone') timezone,'dashboard' channel
      FROM notifications n LEFT JOIN jobs j ON j.id=n.job_id AND j.user_id=n.user_id WHERE n.user_id=?
      UNION ALL
      SELECT d.run_id,d.title,d.message,d.created_at,json_extract(j.schedule,'$.timezone'),'discord'
      FROM discord_deliveries d JOIN job_runs r ON r.id=d.run_id JOIN jobs j ON j.id=r.job_id
      WHERE j.user_id=? AND d.status='sent'
    )
    SELECT title,message,MIN(created_at) created_at,timezone,GROUP_CONCAT(DISTINCT channel) channels
    FROM delivered WHERE created_at>=? AND created_at<? AND (? IS NULL OR instr(lower(title||' '||message),lower(?))>0)
    GROUP BY record_key ORDER BY created_at DESC,record_key DESC LIMIT 11 OFFSET ?`,
    userId,
    userId,
    start,
    end,
    query,
    query,
    offset,
  );
  return {
    items: rows
      .slice(0, 10)
      .map((r) => ({
        ...r,
        created_at: new Date(r.created_at).toISOString(),
        channels: r.channels.split(','),
        message: clipText(r.message, 240),
      })),
    has_more: rows.length > 10,
    next_offset: rows.length > 10 ? offset + 10 : null,
  };
}
