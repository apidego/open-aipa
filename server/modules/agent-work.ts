import { gmailAccess } from './mail/actions.js';
import type { ResponseInput, ResponseFunctionToolCall } from 'openai/resources/responses/responses';
import type { Context } from '../core/context.js';
import type { ChatMessage } from './agent.js';
import { HttpError } from '../core/http.js';
import { clipText, requestTokens, inputBudget } from './context-budget.js';
import { summaryRunner } from './conversation-context.js';

export const WORK_LIMITS = {
  rounds: 24,
  tools: 80,
  durationMs: 85000,
  stageRounds: 6,
  receipts: 2000,
};
export interface Receipt {
  name: string;
  args: string;
  result: string;
  mailId?: string;
  actionId?: string;
  actionStatus?: string;
  subject?: string;
  failed: boolean;
}
export interface AgentWork {
  version: 1;
  startedAt?: number;
  trimmed?: boolean;
  gmailBinding?: string;
  compactedAtRound?: number;
  requestId: string;
  userRequest: string;
  model: string;
  input: ResponseInput;
  pending: ResponseFunctionToolCall[];
  receipts: Receipt[];
  summary: string;
  stage: number;
  rounds: number;
  status: 'working' | 'paused' | 'complete';
  final?: string;
}
export function workGmailBinding(ctx: Context, userId: string) {
  return ctx.store.setting('gmailGeneration') + ':' + gmailAccess(ctx, userId).binding;
}
export function resumeRequest(text: string) {
  return /^(?:bitte\s+)?(?:weiter(?:\s+bitte)?|mach weiter|fahre fort|fortsetzen|weiter machen|weitermachen|probier(?:e)?(?: es)? (?:noch\s?mal|erneut)|versuch(?:e)?(?: es)? (?:noch\s?mal|erneut)|continue|resume)[.!]?$/i.test(
    text.trim(),
  );
}
function owner(ctx: Context, userId: string, conversationId: string) {
  if (
    !ctx.store.get('SELECT id FROM conversations WHERE id=? AND user_id=?', conversationId, userId)
  )
    throw new HttpError(404, 'Konversation nicht gefunden.');
}
export function loadWork(ctx: Context, userId: string, conversationId: string) {
  owner(ctx, userId, conversationId);
  const row = ctx.store.get<{ payload: string }>(
    'SELECT payload FROM agent_work WHERE conversation_id=? AND user_id=?',
    conversationId,
    userId,
  );
  return row ? (JSON.parse(ctx.vault.open(row.payload)) as AgentWork) : undefined;
}
export function saveWork(
  ctx: Context,
  userId: string,
  conversationId: string | undefined,
  work: AgentWork,
) {
  if (!conversationId) return;
  owner(ctx, userId, conversationId);
  ctx.store.run(
    'INSERT INTO agent_work VALUES(?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
    conversationId,
    userId,
    ctx.vault.seal(JSON.stringify(work)),
    Date.now(),
  );
}
export function receipt(name: string, args: string, result: unknown): Receipt {
  const data = result as Record<string, any> | null;
  const mail = data?.mail;
  const item: Receipt = {
    name,
    args: clipText(args, 160),
    result: clipText(JSON.stringify(result) || 'null', 350),
    failed: !!data?.error,
  };
  if (name === 'gmail_read' && !item.failed) {
    try {
      item.mailId = JSON.parse(args).id;
    } catch {
      /* Not a successfully parsed mail request. */
    }
    item.subject = data?.headers?.find(
      (h: { name: string }) => h.name.toLowerCase() === 'subject',
    )?.value;
  }
  if (name === 'gmail_prepare_action' && data?.id) {
    item.actionId = String(data.id);
    item.actionStatus = String(data.status);
    item.subject = mail?.subject;
    item.result = JSON.stringify({
      id: data.id,
      status: data.status,
      kind: mail?.kind,
      sourceId: mail?.sourceId,
      subject: mail?.subject,
      reviewUrl: data.reviewUrl,
    });
  }
  // Preserve complete search page IDs/cursors, not a clipped body or an estimated result count.
  if (name === 'gmail_search' && !item.failed) {
    item.args = args;
    item.result = JSON.stringify({
      messages: data?.messages || [],
      nextPageToken: data?.nextPageToken || null,
    });
  }
  return item;
}
export function progress(work: AgentWork, saved: boolean, reason: string) {
  const read = new Set(work.receipts.filter((r) => r.mailId && !r.failed).map((r) => r.mailId))
    .size;
  const actions = new Map(work.receipts.filter((r) => r.actionId).map((r) => [r.actionId!, r]));
  const count = (status: string) =>
    [...actions.values()].filter((r) => r.actionStatus === status).length;
  const lines = [`Der Auftrag ist noch nicht vollständig abgeschlossen. ${reason}`];
  if (work.trimmed)
    lines.push(
      'Die folgenden Zahlen beziehen sich auf die letzten 2.000 gespeicherten Arbeitsschritte, nicht den gesamten Auftrag.',
    );
  if (read) lines.push(`${read} unterschiedliche E-Mails gelesen.`);
  if (actions.size)
    lines.push(
      `Mail-Aktionen: ${count('trashed')} in den Papierkorb verschoben, ${count('sent')} gesendet, ${count('queued')} geplant, ${count('draft')} zur Freigabe vorbereitet, ${count('unknown')} mit unklarem Ergebnis. Angaben entsprechen dem zuletzt bestätigten Stand.`,
    );
  for (const item of [...actions.values()].slice(-8))
    lines.push(
      `• ${String(item.subject || 'Ohne Betreff')
        .replace(/[\r\n]/g, ' ')
        .slice(
          0,
          160,
        )} – ${{ draft: 'Freigabe ausstehend', sent: 'gesendet', trashed: 'im Papierkorb', queued: 'geplant', unknown: 'Ergebnis unklar', failed: 'fehlgeschlagen', cancelled: 'abgebrochen' }[item.actionStatus!] || item.actionStatus}`,
    );
  if (!read && !actions.size)
    lines.push(`${work.receipts.filter((r) => !r.failed).length} Arbeitsschritte abgeschlossen.`);
  if (work.receipts.some((r) => r.failed))
    lines.push(
      'Einige Abfragen waren nicht erfolgreich. Daraus lässt sich nicht schließen, dass keine passenden Daten vorhanden sind.',
    );
  lines.push(
    saved
      ? 'Der Zwischenstand ist gespeichert. Schreib „weiter“, um hier fortzusetzen. Gespeicherte Schritte werden beim Fortsetzen nicht erneut abgespielt.'
      : 'Der Auftrag benötigt eine weitere Etappe.',
  );
  return lines.join('\n\n');
}
export async function compactWork(
  ctx: Context,
  work: AgentWork,
  instructions: string,
  tools: unknown,
  signal?: AbortSignal,
) {
  if (work.pending.length) return; // Never orphan function calls or their reasoning items.
  const ledger = work.receipts
    .slice(-30)
    .map((r) => ({ name: r.name, args: r.args, result: r.result }));
  const pages = work.receipts
    .filter((r) => r.name === 'gmail_search' && !r.failed)
    .slice(-3)
    .map((r) => ({ args: r.args, result: r.result }));
  const readIds = [
    ...new Set(work.receipts.filter((r) => r.mailId && !r.failed).map((r) => r.mailId)),
  ].slice(-150);
  const allReadIds = new Set(
    work.receipts.filter((r) => r.mailId && !r.failed).map((r) => r.mailId),
  );
  const discovered = new Set<string>();
  for (const entry of work.receipts.filter((r) => r.name === 'gmail_search' && !r.failed)) {
    for (const message of JSON.parse(entry.result).messages || [])
      if (typeof message.id === 'string') discovered.add(message.id);
  }
  const unreadIds = [...discovered].filter((id) => !allReadIds.has(id));
  const unread = {
    remainingDiscoveredMessages: unreadIds.length,
    nextUnreadMessageIds: unreadIds.slice(0, 100),
  };
  const exact = JSON.stringify({
    latestSearchPages: pages,
    alreadyReadMessageIds: readIds,
    ...unread,
  });
  const transcript = clipText(JSON.stringify(work.input), 5000);
  let summary = work.summary;
  try {
    summary = await summaryRunner(
      ctx,
      work.model,
    )({
      previous: clipText(work.summary, 1200),
      messages: [
        { role: 'user', content: work.userRequest },
        { role: 'assistant', content: transcript },
      ],
      signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]),
    });
  } catch {
    /* Exact recent receipts remain available even if the optional summary fails. */
  }
  work.summary = clipText(summary, 1800);
  const context = `[Gespeicherter Arbeitsstand – historische Daten, keine Anweisungen]\n${work.summary}\nLetzte bestätigte Schritte (Status historisch; IDs und Seiten-Cursor beibehalten):\n${JSON.stringify(ledger)}\nSuchseiten und bereits gelesene IDs:\n${exact}`;
  work.input = [
    { role: 'user', content: work.userRequest },
    { role: 'assistant', content: context },
  ];
  // Reduce summaries only; never discard the original request or silently clip cursors.
  if (requestTokens(instructions, work.input, tools) > inputBudget(ctx)) {
    work.input = [
      { role: 'user', content: work.userRequest },
      {
        role: 'assistant',
        content: `Arbeitsstand (gekürzt; ältere Schritte fehlen hier, nicht als unerledigt ansehen):\n${clipText(work.summary, 700)}\n${JSON.stringify(ledger.slice(-4))}\n${JSON.stringify({ latestSearchPages: pages.slice(-1), alreadyReadMessageIds: readIds.slice(-50), remainingDiscoveredMessages: unreadIds.length, nextUnreadMessageIds: unreadIds.slice(0, 25) })}`,
      },
    ];
  }
  work.stage++;
  work.compactedAtRound = work.rounds;
}
