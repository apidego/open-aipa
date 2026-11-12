import { conversationLocks } from '../modules/conversation-locks.js';
import { randomUUID } from 'node:crypto';
import type { Context } from '../core/context.js';
import { HttpError } from '../core/http.js';
import { digest } from '../core/security.js';
import { conversationContext, type PrepareContext } from '../modules/conversation-context.js';
import { AGENT_TIMEOUT_MS, type RunAgent } from '../modules/agent.js';
import { integrationEnabled } from './state.js';
export interface DirectMessage {
  id: string;
  userId: string;
  channelId: string;
  content: string;
  createdAt: number;
  direct: boolean;
  bot: boolean;
  webhook: boolean;
}
export interface DiscordLink {
  id: string;
  user_id: string;
  discord_user_id: string;
  channel_id: string;
  conversation_id: string | null;
}
export type SendReply = (
  channelId: string,
  content: string,
  allowed?: () => boolean,
) => Promise<void>;
// No model-visible send function: only a linked inbound DM authorizes a reply to that DM.
export function discordMessages(
  ctx: Context,
  runAgent: RunAgent,
  send: SendReply,
  alive: () => boolean = () => true,
  prepare: PrepareContext = conversationContext(ctx),
) {
  const { store } = ctx;
  const busy = new Set<string>();
  const locks = conversationLocks(ctx);
  const limited = new Map<string, { until: number; count: number }>();
  return async (message: DirectMessage) => {
    if (
      !alive() ||
      !integrationEnabled(ctx, 'discord') ||
      !store.setting('discordBotToken') ||
      !message.direct ||
      message.bot ||
      message.webhook
    )
      return;
    if (
      !/^\d{17,20}$/.test(message.userId) ||
      !/^\d{17,20}$/.test(message.channelId) ||
      !/^\d{17,20}$/.test(message.id)
    )
      return;
    if (
      !Number.isFinite(message.createdAt) ||
      Math.abs(Date.now() - message.createdAt) > 10 * 60000
    )
      return;
    for (const [key, value] of limited) if (value.until < Date.now()) limited.delete(key);
    if (limited.size >= 1000 && !limited.has(message.userId)) return;
    const rate = limited.get(message.userId) || { until: Date.now() + 60000, count: 0 };
    limited.set(message.userId, rate);
    if (++rate.count > 10) return;
    store.run('DELETE FROM discord_receipts WHERE created_at<?', Date.now() - 86400000);
    if (
      !store.run('INSERT OR IGNORE INTO discord_receipts VALUES(?,?)', message.id, Date.now())
        .changes
    )
      return;
    const generation = store.setting('discordGeneration');
    const active = () =>
      alive() &&
      integrationEnabled(ctx, 'discord') &&
      store.setting('discordGeneration') === generation;
    const reply = async (text: string) => {
      if (active()) await send(message.channelId, text, active);
    };
    const pairing = /^!verbinden\s+([a-f0-9]{32})$/i.exec(message.content.trim());
    if (pairing) {
      const code = store.get<{ user_id: string }>(
        'SELECT user_id FROM discord_pairings WHERE code_hash=? AND expires_at>?',
        digest(pairing[1].toLowerCase()),
        Date.now(),
      );
      if (
        !code ||
        store.get(
          'SELECT 1 FROM discord_links WHERE discord_user_id=? OR user_id=?',
          message.userId,
          code.user_id,
        )
      ) {
        await reply(
          'Code ungültig, abgelaufen oder Konto bereits verknüpft. Erstelle einen neuen Code in Open AIPA.',
        );
        return;
      }
      store.transaction(() => {
        store.run('DELETE FROM discord_pairings WHERE user_id=?', code.user_id);
        store.run(
          'INSERT INTO discord_links VALUES(?,?,?,?,NULL)',
          randomUUID(),
          code.user_id,
          message.userId,
          message.channelId,
        );
        store.run(
          "INSERT INTO connections VALUES(?,'discord',?)",
          code.user_id,
          ctx.vault.seal('{}'),
        );
      });
      await reply(
        'Discord ist verbunden. Schreibe mir hier deinen Auftrag. Mit !neu startest du eine neue Konversation; !trennen beendet die Verknüpfung.',
      );
      return;
    }
    const link = store.get<DiscordLink>(
      'SELECT * FROM discord_links WHERE discord_user_id=? AND channel_id=?',
      message.userId,
      message.channelId,
    );
    if (!link) {
      await reply(
        'Verknüpfe zuerst dein Konto unter Open AIPA → Integrationen → Discord. Sende den dort erzeugten Befehl hier als Direktnachricht.',
      );
      return;
    }
    const linked = () =>
      active() &&
      !!store.get('SELECT 1 FROM discord_links WHERE id=? AND user_id=?', link.id, link.user_id);
    if (message.content.trim() === '!trennen') {
      store.transaction(() => {
        store.run('DELETE FROM discord_links WHERE id=?', link.id);
        store.run("DELETE FROM connections WHERE user_id=? AND provider='discord'", link.user_id);
        store.run('DELETE FROM discord_pairings WHERE user_id=?', link.user_id);
      });
      await reply('Die Discord-Verknüpfung wurde getrennt.');
      return;
    }
    if (busy.has(link.user_id) || busy.size >= 5) {
      await reply('Eine Antwort wird noch erstellt. Bitte sende deinen Auftrag gleich erneut.');
      return;
    }
    if (message.content.trim() === '!neu') {
      store.run('UPDATE discord_links SET conversation_id=NULL WHERE id=?', link.id);
      await reply('Die nächste Nachricht beginnt eine neue Konversation.');
      return;
    }
    const content = message.content.trim();
    if (!content || content.length > 16000) {
      await reply(
        'Bitte sende eine Textnachricht mit höchstens 16.000 Zeichen. Anhänge werden noch nicht verarbeitet.',
      );
      return;
    }
    if (link.conversation_id && locks.has(link.conversation_id)) {
      await reply('Eine Antwort wird im Dashboard erstellt. Bitte gleich erneut senden.');
      return;
    }
    busy.add(link.user_id);
    let lockedId: string | undefined;
    const abort = new AbortController();
    const monitor = setInterval(() => {
      if (!linked()) abort.abort();
    }, 250);
    monitor.unref();
    try {
      let conversationId = link.conversation_id;
      if (!conversationId) {
        conversationId = randomUUID();
        store.transaction(() => {
          store.run(
            'INSERT INTO conversations VALUES(?,?,?,?)',
            conversationId!,
            link.user_id,
            'Discord · ' + content.slice(0, 60),
            Date.now(),
          );
          store.run(
            'UPDATE discord_links SET conversation_id=? WHERE id=?',
            conversationId!,
            link.id,
          );
        });
      }
      lockedId = conversationId;
      locks.add(conversationId);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(AGENT_TIMEOUT_MS)]);
      const context = await prepare(link.user_id, conversationId, content, signal);
      if (!linked()) return;
      if (context.notice) await send(message.channelId, context.notice, linked);
      const result = await runAgent(link.user_id, context.messages, undefined, { signal });
      if (
        !linked() ||
        !store.get(
          'SELECT 1 FROM conversations WHERE id=? AND user_id=?',
          conversationId,
          link.user_id,
        )
      )
        return;
      store.transaction(() => {
        for (const [role, text] of [
          ['user', content],
          ['assistant', result],
        ])
          store.run(
            'INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)',
            conversationId!,
            role,
            text,
            Date.now(),
          );
      });
      // Discord caps content at 2,000 characters. Bound delivery to 10 messages.
      const output =
        result.slice(0, 18000) +
        (result.length > 18000 ? '\n[Antwort gekürzt. Vollständig im Dashboard.]' : '');
      for (let offset = 0; offset < output.length; offset += 1900) {
        if (!linked()) return;
        await send(message.channelId, output.slice(offset, offset + 1900), linked);
      }
    } catch (error) {
      if (linked())
        await reply(
          error instanceof HttpError
            ? error.message
            : 'Antwort oder Zustellung fehlgeschlagen. Prüfe die Konversation im Dashboard, bevor du den Auftrag erneut sendest.',
        );
    } finally {
      clearInterval(monitor);
      busy.delete(link.user_id);
      if (lockedId) locks.delete(lockedId);
    }
  };
}
