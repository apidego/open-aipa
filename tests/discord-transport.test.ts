import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  options: {} as any,
  events: new Map<string, Function>(),
  fetch: vi.fn(),
  send: vi.fn(),
  login: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('discord.js', () => ({
  Client: class {
    channels = { fetch: sdk.fetch };
    constructor(options: unknown) {
      sdk.options = options;
    }
    on(event: string, cb: Function) {
      sdk.events.set(event, cb);
    }
    login = sdk.login;
    destroy = sdk.destroy;
    isReady() {
      return true;
    }
  },
  Events: { Error: 'error', MessageCreate: 'message' },
  GatewayIntentBits: { DirectMessages: 4096 },
  Partials: { Channel: 1 },
  ChannelType: { DM: 1 },
}));
import { discordTransport } from '../server/integrations/discord-runtime.js';
beforeEach(() => {
  sdk.events.clear();
  sdk.fetch.mockReset().mockResolvedValue({ type: 1, send: sdk.send });
  sdk.send.mockReset().mockResolvedValue({});
});
it('requests only DMs and suppresses mentions and link embeds in actual outbound payloads', async () => {
  const transport = discordTransport(vi.fn());
  expect(sdk.options.intents).toEqual([4096]);
  await transport.send('channel', '@everyone <@123> https://example.test');
  expect(sdk.send).toHaveBeenCalledWith({
    content: '@everyone <@123> https://example.test',
    allowedMentions: { parse: [], repliedUser: false },
    flags: 4,
  });
});
it('refuses guild destinations and rechecks authorization after asynchronous channel lookup', async () => {
  const transport = discordTransport(vi.fn());
  sdk.fetch.mockResolvedValueOnce({ type: 0, send: sdk.send });
  await expect(transport.send('guild', 'private')).rejects.toThrow();
  expect(sdk.send).not.toHaveBeenCalled();
  let allowed = true;
  sdk.fetch.mockImplementationOnce(async () => {
    allowed = false;
    return { type: 1, send: sdk.send };
  });
  await transport.send('dm', 'private', () => allowed);
  expect(sdk.send).not.toHaveBeenCalled();
});
it('maps authenticated Gateway author/channel information and drops raw SDK errors', () => {
  const receive = vi.fn();
  discordTransport(receive);
  sdk.events.get('message')!({
    id: 'msg',
    author: { id: 'author', bot: false },
    channelId: 'dm',
    channel: { type: 1 },
    content: 'hi',
    createdTimestamp: 123,
    guildId: null,
    webhookId: null,
  });
  expect(receive).toHaveBeenCalledWith({
    id: 'msg',
    userId: 'author',
    channelId: 'dm',
    content: 'hi',
    createdAt: 123,
    direct: true,
    bot: false,
    webhook: false,
  });
  expect(() => sdk.events.get('error')!(new Error('credential'))).not.toThrow();
});
