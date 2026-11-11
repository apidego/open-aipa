# Discord direct-message channel

Discord is an explicitly registered integration. It uses an outbound Discord Gateway connection, so the same setup works on localhost and public HTTPS installations without a public webhook, tunnel or inbound port. Run only one application process per database/bot token.

## Setup

1. As an Open AIPA administrator, activate **Integrations → Discord**, then open its gear button.
2. Open the linked [Discord Developer Portal](https://discord.com/developers/applications), create an application, and obtain its **Bot token** under **Bot**. This is not the OAuth client secret. Leave privileged intents off; this channel subscribes only to `DirectMessages` and does not read guild messages.
3. Save the token in the popup. The server validates it with Discord and stores it encrypted. The token is never returned to the browser. The Gateway starts within about five seconds. The popup shows online/connecting/error status; login failures retry after a minute. Saving a replacement token invalidates every existing personal binding and pairing code.
4. Use **Add bot to server** to install the bot in a server you manage. The link requests only the `bot` scope and no administrator/server permissions. The user and bot need a shared server and Discord must allow direct messages. Open the bot profile and start a direct message.
5. Every Open AIPA user opens Discord's integration settings and chooses **Link Discord account**. Send the displayed `!verbinden …` command to the bot privately. The code lasts ten minutes, can be revoked/replaced, is stored only as a hash, and must not be shared. The bot confirms the binding and the popup updates automatically.
6. Send a text request in the DM. The existing agent runs as the linked Open AIPA user with that user's enabled integrations. The conversation is also visible in their dashboard. `!neu` starts a fresh conversation on the next message; `!trennen` revokes the personal binding. The dashboard can also disconnect it.

## Authorization and delivery

A code authorizes one Discord identity to act as its generating Open AIPA user; neither an email address in a message nor a model argument can select an owner. Both Open AIPA and Discord identities are unique per binding. Guild/group messages, bots and webhooks are ignored. Unlinked DMs only receive connection instructions, never invoke AI. Discord IDs and channel IDs are stored server-side, and routes return only the current user's binding.

Sending a DM to the linked bot explicitly authorizes processing by the agent and delivery of its reply to that same private channel. There is no arbitrary-recipient send tool and no ability for a model to select a Discord destination. Outgoing mentions and embeds are suppressed. Attachments, audio and server-channel conversations are not supported. Scheduled tasks and scripts can also send conditional results to the linked DM after explicit activation approval; see [scheduled delivery](scheduled-jobs.md#notification-channels). There is no arbitrary-recipient sending tool.

Deactivation stops use immediately and closes the Gateway on the next five-second check. Keeping configuration preserves encrypted token and bindings; deleting it removes the token, bot identity and all bindings. Pending pairing codes are invalidated either way. Already dispatched requests cannot be recalled. In-flight answers are checked against activation, configuration generation and the exact personal binding before persistence and each send; disconnecting or replacing the token suppresses stale answers. Saved dashboard conversations remain.

Each user's turns are serialized and share conversation locks with the dashboard. The channel accepts at most ten events per Discord user per minute, five simultaneous agent calls, and text up to 16,000 characters. Agent requests have a 120-second abort signal. Discord replies are split below its 2,000-character limit, with at most ten chunks; the full answer remains in the dashboard. Message IDs are recorded before processing and retained for one day to deduplicate Gateway replay across process restarts. Events older than ten minutes are ignored. Interrupted processing is not replayed automatically: inspect dashboard history before resending. This is not an exactly-once messaging system, and partial delivery can occur if Discord fails midway.

External service tests use mocked transport, Discord validation responses and AI; real delivery requires a valid bot token, internet access and a linked Discord account. Never commit tokens, pairing commands, real Discord messages or account data into review screenshots.

References: [Gateway and intents](https://docs.discord.com/developers/events/gateway), [Discord messages](https://docs.discord.com/developers/resources/message), [discord.js](https://discord.js.org/docs/packages/discord.js/stable).

## Recalling reminders

The assistant can use the read-only `notification_history` tool to look up the authenticated owner's delivered dashboard notifications and successfully sent Discord reminders, including existing records. Results are date/text-filtered, paginated, bounded excerpts with creation timestamps and task timezone. Combined deliveries appear once with both confirmed channels. Pending, failed and silent runs are excluded. The timestamp is when the notification was recorded, not necessarily when Discord delivered it. Deleted Discord-only task histories are no longer available. This is owner-wide notification history, including across new conversations; it does not read arbitrary Discord messages or send anything.
