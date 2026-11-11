import { discordDelivery } from './discord-delivery.js';
import { syncBotProfile } from '../modules/bot-profile.js';
import { Client, Events, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { conversationContext, type PrepareContext } from '../modules/conversation-context.js';
import type { Context } from '../core/context.js';
import type { RunAgent } from '../modules/agent.js';
import { discordMessages, type DirectMessage, type SendReply } from './discord-channel.js';
import { integrationEnabled } from './state.js';
import type { DiscordStatus } from './discord.js';
export interface DiscordTransport {
  login(token: string): Promise<unknown>;
  destroy(): Promise<void>;
  ready(): boolean;
  send: SendReply;
}
export type DiscordTransportFactory = (
  receive: (message: DirectMessage) => void,
) => DiscordTransport;
export const discordTransport: DiscordTransportFactory = (receive) => {
  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
    allowedMentions: { parse: [], repliedUser: false },
    rest: { timeout: 15000, retries: 0 },
  });
  // Never log SDK errors: they may include request/credential data.
  client.on(Events.Error, () => {});
  client.on(Events.MessageCreate, (message) => {
    receive({
      id: message.id,
      userId: message.author.id,
      channelId: message.channelId,
      content: message.content,
      createdAt: message.createdTimestamp,
      direct: message.channel.type === ChannelType.DM && !message.guildId,
      bot: message.author.bot,
      webhook: !!message.webhookId,
    });
  });
  return {
    login: (token) => client.login(token),
    destroy: () => client.destroy(),
    ready: () => client.isReady(),
    async send(channelId, content, allowed) {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.DM)
        throw new Error('Private channel unavailable');
      if (allowed && !allowed()) return;
      await channel.send({ content, allowedMentions: { parse: [], repliedUser: false }, flags: 4 });
    },
  };
};
export function discordRuntime(
  ctx: Context,
  runAgent: RunAgent,
  factory = discordTransport,
  prepare: PrepareContext = conversationContext(ctx),
) {
  let transport: DiscordTransport | undefined,
    current = '',
    state: DiscordStatus['state'] = 'offline';
  let timer: ReturnType<typeof setInterval> | undefined,
    retryAt = 0,
    epoch = 0,
    transitioning = false,
    stopped = false;
  const desired = () =>
    integrationEnabled(ctx, 'discord') && ctx.store.setting('discordBotToken')
      ? ctx.store.setting('discordBotToken') + ':' + ctx.store.setting('discordGeneration')
      : '';
  const drain = discordDelivery(
    ctx,
    async (channel, content, allowed) => {
      const active = transport;
      if (!active || !active.ready()) throw new Error('Discord unavailable');
      await active.send(channel, content, () => transport === active && !!allowed?.());
      if (transport !== active) throw new Error('Discord changed');
    },
    () => !stopped && !!transport?.ready() && desired() === current,
  );
  async function sync() {
    if (stopped) return;
    void syncBotProfile(ctx).catch(() => {});
    void drain().catch(() => {});
    const key = desired();
    if (key === current && (transport || transitioning || !key || Date.now() < retryAt)) return;
    const revision = ++epoch,
      old = transport;
    transport = undefined;
    current = key;
    state = 'offline';
    transitioning = true;
    try {
      await old?.destroy();
      if (revision !== epoch || !key || stopped) return;
      state = 'connecting';
      let handler: ReturnType<typeof discordMessages>;
      const next = factory((message) => {
        if (alive()) void handler(message).catch(() => {});
      });
      const alive = () => !stopped && transport === next && desired() === key;
      handler = discordMessages(
        ctx,
        runAgent,
        async (channelId, content, allowed) => {
          if (alive())
            await next.send(channelId, content, () => alive() && (!allowed || allowed()));
        },
        alive,
        prepare,
      );
      transport = next;
      // Login may remain pending during a network outage. Never block deactivation/reconfiguration on it.
      void next
        .login(ctx.vault.open(ctx.store.setting('discordBotToken')))
        .then(() => {
          if (transport === next) state = 'online';
        })
        .catch(async () => {
          if (transport !== next) return;
          transport = undefined;
          state = 'error';
          retryAt = Date.now() + 60000;
          await next.destroy();
        })
        .catch(() => {});
    } finally {
      if (revision === epoch) transitioning = false;
    }
  }
  return {
    start() {
      if (timer) return;
      stopped = false;
      void sync().catch(() => {
        state = 'error';
      });
      timer = setInterval(
        () =>
          void sync().catch(() => {
            state = 'error';
          }),
        5000,
      );
      timer.unref();
    },
    async stop() {
      stopped = true;
      ++epoch;
      transitioning = false;
      current = '';
      if (timer) clearInterval(timer);
      timer = undefined;
      const old = transport;
      transport = undefined;
      state = 'offline';
      await old?.destroy();
      await drain.idle();
    },
    sync,
    status(): DiscordStatus {
      return {
        state: !integrationEnabled(ctx, 'discord')
          ? 'offline'
          : transport?.ready()
            ? 'online'
            : state === 'online'
              ? 'connecting'
              : state,
      };
    },
  };
}
