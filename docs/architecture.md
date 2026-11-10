# Architecture

OpenAI PA is a single-process, self-hosted application. Express serves a React/Vite frontend and JSON/SSE APIs. Node's SQLite driver persists data in WAL mode. No hosted application platform is required.

```text
web/pages → same-origin API → server/modules → SQLite
                                  ├─ agent → OpenAI Responses API
                                  ├─ integrations registry → Gmail OAuth/API
                                  └─ scheduler → agent → persisted run result
```

## Boundaries

- `server/core`: environment validation, database, encryption, HTTP errors and shared context.
- `server/modules/auth`: setup, sessions, passwords and admin-only user management.
- `server/modules/conversations`: ownership checks, bounded conversation history, SSE and atomic completed exchanges.
- `server/modules/agent`: Responses API streaming and a bounded tool loop (5 rounds, 4,096 output tokens per response). `RunAgent` is injected for offline tests.
- `server/integrations`: typed provider contract, explicit registry and Gmail adapter. Tools use the authenticated user's connection, never a model-provided user ID.
- `server/modules/automations`: interval definitions, single-process scheduler, claims and execution history.
- `web/pages`: route-specific screens; `web/components`: common UI elements.

## Identity and secrets

The installer generates an encryption key and setup token. The browser must present the setup token before creating the first admin. A transaction makes setup one-time even with concurrent requests. Only authenticated admins can add users. Passwords use salted scrypt, sessions use random opaque tokens whose hashes are stored in SQLite, and cookies are HttpOnly/SameSite=Lax (Secure for HTTPS). Sessions expire after seven days; password changes invalidate existing sessions.

Every mutating API request requires an exact `Origin` match with `APP_URL`. Gmail callbacks use one-time, expiring OAuth state bound to the initiating session and PKCE. API keys, Google client secrets and OAuth credentials use AES-256-GCM. Decrypted credentials never go to the browser.

The instance-wide OpenAI key, model and system prompt are admin-managed. Conversations, Gmail connections, automations and results belong to individual users. Administrators can manage users, not query their conversations through the API; the server operator still controls the underlying database.

## Storage and migrations

The initial schema is version 1 (`migrations` table). Future schema changes must use new numbered, transactional migrations and preserve existing installations. Do not rely on changing `CREATE TABLE IF NOT EXISTS` to alter deployed tables. Back up before upgrades.

Completed chat exchanges are inserted atomically. A failed response leaves no partial persisted exchange and can be retried; a network interruption may still finish server-side, so reload before resending. Only the newest 60 messages are sent as context. There is no semantic long-term memory yet. Generated text is rendered as Markdown with raw HTML disabled.

## Adding integrations

Implement `Integration`, define narrowly scoped JSON-schema function tools and validate arguments at runtime. Register the provider explicitly. Add connection routes, ownership tests and setup documentation. Keep provider-specific protocol code out of the agent. Integration outputs are untrusted data; errors sent to the model must not expose credentials. External write operations require a separately designed user confirmation mechanism before adding them.

## Scheduling

The worker checks every 30 seconds and claims at most five due tasks per tick. A task's next run is moved forward before calling the provider; failed attempts are recorded and wait for the next interval. Missed intervals coalesce into one execution after restart. Interrupted runs are marked failed at startup; they are not replayed automatically. First run occurs one full interval after creation/reactivation. Each job has a fresh conversation context and uses current settings/connections. The server must stay running.

Run **one application process/replica** per database. This is not a distributed queue; add a durable multi-worker job system in a separate issue before scaling. Current bounds: 20 automations/user, minimum 15-minute interval, 16,000-character prompts, rate-limited API. No monthly spending cap, notification delivery, cron/time-zone scheduling, arbitrary executable plugins or cross-conversation memory yet.
