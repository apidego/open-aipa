# Architecture

Open AIPA is a single-process, self-hosted application. Express serves a React/Vite frontend and JSON/SSE APIs. Node's SQLite driver persists data in WAL mode. No hosted application platform is required.

```text
web/pages → same-origin API → server/modules → SQLite
                                  ├─ agent → OpenAI Responses API
                                  ├─ integrations registry → Gmail OAuth/API
                                  └─ scheduler → script sandbox / agent → run result + optional notification
```

## Boundaries

- `server/core`: environment validation, database, encryption, HTTP errors and shared context.
- `server/modules/auth`: setup, sessions, passwords and admin-only user management.
- `server/modules/conversations`: ownership checks, bounded conversation history, SSE and atomic completed exchanges.
- `server/modules/agent`: Responses API streaming and a bounded tool loop (5 rounds, 4,096 output tokens per response). `RunAgent` is injected for offline tests.
- `server/integrations`: typed provider contract, activation lifecycle, explicit registry, Gmail adapter and Discord DM channel. Tools use the authenticated user's connection, never a model-provided user ID.
- `server/modules/jobs`: natural-language planning, schedules, script sandbox, AI task execution, claims, history and notification delivery.
- `web/pages`: route-specific screens; `web/components`: common UI elements.

## Identity and secrets

The installer generates an encryption key and setup token. The browser must present the setup token before creating the first admin. A transaction makes setup one-time even with concurrent requests. Only authenticated admins can add users. Passwords use salted scrypt, sessions use random opaque tokens whose hashes are stored in SQLite, and cookies are HttpOnly/SameSite=Lax (Secure for HTTPS). Sessions expire after seven days; password changes invalidate existing sessions.

Every mutating API request requires an exact `Origin` match with `APP_URL`. Gmail callbacks use one-time, expiring OAuth state bound to the initiating session and PKCE. API keys, Google client secrets and OAuth credentials use AES-256-GCM. Decrypted credentials never go to the browser.

The instance-wide OpenAI key, model and system prompt are admin-managed. Conversations, Gmail connections, automations and results belong to individual users. Administrators can manage users, not query their conversations through the API; the server operator still controls the underlying database.

## Storage and migrations

Schema versions are tracked in `migrations`. Version 5 adds approved per-job Discord destinations and a durable delivery outbox. Version 4 adds cascading per-conversation summaries and coverage cursors. Version 3 adds user-owned Discord bindings, expiring hashed pairing codes and message receipts without modifying existing conversations. Version 2 copies legacy AI automations and their run history into `jobs` (kind `task`) and `job_runs`, preserving IDs, prompts, ownership, pause state and next execution time. The legacy tables remain as an archive and are no longer read by the application scheduler. Future schema changes must use new numbered, transactional migrations and preserve existing installations. Do not rely on changing `CREATE TABLE IF NOT EXISTS` to alter deployed tables. Back up before upgrades.

Completed chat exchanges are inserted atomically. A failed response leaves no partial persisted exchange and can be retried; a network interruption may still finish server-side, so reload before resending. Dashboard and Discord use a shared token-budgeted context service with recent complete exchanges and incremental per-conversation summaries. See [conversation context](conversation-context.md) for limits, failure handling and costs. There is no cross-conversation long-term memory. Generated text is rendered as Markdown with raw HTML disabled.

## Adding integrations

Implement `Integration`, define narrowly scoped JSON-schema function tools and validate arguments at runtime. Register the provider explicitly. Add connection routes, ownership tests and setup documentation. Keep provider-specific protocol code out of the agent. Integration outputs are untrusted data; errors sent to the model must not expose credentials. External write operations require a separately designed user confirmation mechanism before adding them.

## Scheduling

`jobs` separates `automation` (stored JavaScript) from `task` (AI at execution). Natural-language planning uses the configured OpenAI model with structured output, current time, timezone and only the user's connected capabilities. It never executes tools during planning. Unsupported destinations/actions and ambiguous schedules produce clarification. The resulting description, schedule and script are saved as an inactive draft; activation is an authenticated, origin-checked operation on the stored draft, not client-supplied code.

Schedules support one-off ISO instants, minute intervals and five-field cron expressions with an IANA timezone. Cron parsing is strict and rejects simultaneous day-of-month/weekday restrictions. Recurrence is computed from the current time; missed recurring executions coalesce into one run. Overdue one-offs run once when the server is available. DST behavior follows cron-parser; non-existent local times move to the next valid occurrence. The UI shows upcoming times before activation. A resumed one-off must still be in the future.

The worker checks every 30 seconds and claims at most five due jobs per tick. Claims advance the next execution before work begins. A local lock prevents overlapping ticks. Run results, script state and any notification commit together. A deleted job cannot deliver an in-flight result. Pausing affects future claims; it does not cancel work already claimed. Interrupted runs are marked failed on restart and never replayed automatically; one-offs become completed after their attempt. Failed jobs remain visible in history without exposing provider details.

### Script boundary

Generated function bodies execute inside QuickJS compiled to WebAssembly, not in Node's `vm` or `eval`. The guest receives JSON state/time and explicit host capabilities. No Node globals, shell, filesystem, environment, arbitrary HTTP, module loader or credentials are exposed. Standard JavaScript computation is allowed. The runtime is limited to 16 MiB guest heap, 256 KiB stack, approximately one second of synchronous computation, 120 seconds total, 20 capability calls, two explicit AI calls, and bounded input/output/state sizes. Host waits do not consume the CPU budget. The guest can block the event loop for up to its CPU budget; this remains a single-process, self-hosted service, not a hostile multi-tenant compute platform.

`pa.tool(name,args)` delegates to the existing integration registry with the job owner's user ID; each call verifies the job and current connection. Integrations must explicitly list script-safe tools. Gmail exposes only `gmail_search` and `gmail_read` and retains its existing OAuth/token refresh and readonly scope. `pa.ai(prompt)` is server-blocked unless that automation was activated with AI access allowed. Otherwise script execution never calls the model. `pa.state` persists only after successful completion. See [scheduled jobs](scheduled-jobs.md) for the contract.

Tasks use the regular tool-enabled agent with a structured result (`notify`, `title`, `message`). An unmet condition can complete with `notify=false`, retaining a run record without creating a notification. Tool failures fail the task rather than treating unavailable data as a negative match. Email/tool content remains untrusted data.

### Delivery

Notifications belong to the owner and are delivered through an explicit channel boundary. `dashboard`, explicitly approved, personally linked `discord` DMs, and combined `dashboard_discord` delivery are supported. New drafts default to all available channels, snapshotted before approval; explicit single-channel requests override that default. Existing jobs keep their approved destinations. A model cannot select arbitrary recipients. Draft activation confirms the exact binding; a transactional outbox commits with the run result and sends separately through the active Discord transport. Every send rechecks the binding and integration generation. Pending/sent/failed states appear in task history; uncertain sends are never automatically replayed. Discord-only requests never fall back to dashboard notifications. See [scheduled jobs](scheduled-jobs.md#notification-channels) for delivery guarantees and [Discord](discord.md) for binding authorization. Other external actions require their own explicit approval design. Read markers are owner-scoped. The dashboard polls every 15 seconds and displays the latest 50 notifications; it is not background browser push.

Run **one application process/replica** per database. Current bounds: 40 jobs including drafts per user, five planning requests per five minutes per user, minimum one-minute intervals, 16,000-character prompts and bounded scripts/results. The scheduler is not a distributed queue or a guaranteed real-time service. No monthly spending cap is implemented.
