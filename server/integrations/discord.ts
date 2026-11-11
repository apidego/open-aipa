import { discordHistory, discordHistoryTool } from './discord-history.js';
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Context } from '../core/context.js';
import { admin, HttpError } from '../core/http.js';
import { digest } from '../core/security.js';
import type { Integration } from './types.js';
import { requireIntegration } from './state.js';
export const discord: Integration = {
  id: 'discord',
  name: 'Discord',
  description: 'Mit deinem PA per Discord-Direktnachricht sprechen.',
  tools: [discordHistoryTool],
  configured: (ctx) => !!ctx.store.setting('discordBotToken'),
  deactivate(ctx) {
    ctx.store.run('DELETE FROM discord_pairings');
    ctx.store.set('discordGeneration', randomBytes(16).toString('hex'));
  },
  clearConfiguration(ctx) {
    ctx.store.run(
      "DELETE FROM settings WHERE key IN ('discordBotToken','discordBotId','discordBotName')",
    );
    ctx.store.run('DELETE FROM discord_links');
  },
  async execute(ctx, userId, name, args) {
    if (name !== discordHistoryTool.name) throw new Error('Unknown Discord tool');
    return discordHistory(ctx, userId, args);
  },
};
export type DiscordStatus = { state: 'offline' | 'connecting' | 'online' | 'error' };
export async function inspectDiscordBot(token: string) {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    return z
      .object({
        id: z.string().regex(/^\d{17,20}$/),
        username: z.string().max(100),
        bot: z.literal(true),
      })
      .parse(await response.json());
  } catch {
    throw new HttpError(
      400,
      'Bot-Token konnte nicht geprüft werden. Token und Discord-Erreichbarkeit prüfen.',
    );
  }
}
export function discordRoutes(ctx: Context, status: () => DiscordStatus) {
  const router = Router();
  const { store, vault } = ctx;
  router.use((_req, _res, next) => {
    requireIntegration(ctx, 'discord');
    next();
  });
  router.get('/settings', (req, res) => {
    const botId = store.setting('discordBotId');
    const link = store.get<{ discord_user_id: string }>(
      'SELECT discord_user_id FROM discord_links WHERE user_id=?',
      req.user!.id,
    );
    res.json({
      hasBotToken: !!store.setting('discordBotToken'),
      botName: store.setting('discordBotName'),
      botId,
      inviteUrl: botId
        ? `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot&permissions=0`
        : '',
      botUrl: botId ? `https://discord.com/users/${botId}` : '',
      discordUserId: link?.discord_user_id || '',
      ...status(),
    });
  });
  router.put('/settings', admin, async (req, res) => {
    const { botToken } = z
      .object({ botToken: z.string().trim().min(1).max(500) })
      .strict()
      .parse(req.body);
    const generation = store.setting('discordGeneration');
    const bot = await inspectDiscordBot(botToken);
    requireIntegration(ctx, 'discord');
    if (store.setting('discordGeneration') !== generation)
      throw new HttpError(409, 'Konfiguration wurde geändert. Bitte erneut speichern.');
    store.transaction(() => {
      // Token replacement revokes old bindings, including in-flight replies.
      discord.deactivate!(ctx);
      store.run('DELETE FROM discord_links');
      store.run("DELETE FROM connections WHERE provider='discord'");
      store.set('discordBotToken', vault.seal(botToken));
      store.set('discordBotId', bot.id);
      store.set('discordBotName', bot.username);
    });
    res.json({ ok: true });
  });
  router.post('/pairing', (req, res) => {
    if (!discord.configured(ctx))
      throw new HttpError(409, 'Der Administrator muss zuerst den Discord-Bot konfigurieren.');
    if (store.get('SELECT 1 FROM discord_links WHERE user_id=?', req.user!.id))
      throw new HttpError(409, 'Discord ist bereits verbunden. Bitte zuerst trennen.');
    const code = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 10 * 60000;
    store.run('DELETE FROM discord_pairings WHERE expires_at<=?', Date.now());
    store.run(
      'INSERT INTO discord_pairings VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at',
      digest(code),
      req.user!.id,
      expiresAt,
    );
    res.json({ code, expiresAt });
  });
  router.delete('/pairing', (req, res) => {
    store.run('DELETE FROM discord_pairings WHERE user_id=?', req.user!.id);
    res.json({ ok: true });
  });
  router.delete('/', (req, res) => {
    store.transaction(() => {
      store.run('DELETE FROM discord_pairings WHERE user_id=?', req.user!.id);
      store.run('DELETE FROM discord_links WHERE user_id=?', req.user!.id);
      store.run("DELETE FROM connections WHERE user_id=? AND provider='discord'", req.user!.id);
    });
    res.json({ ok: true });
  });
  return router;
}
