# Operations

## Deployment

Use Node.js 24+ or Docker Compose. `node scripts/install.mjs` writes a private `.env` with fresh secrets and prints the setup token. The web wizard creates the admin and configures OpenAI. API credentials are stored locally; setup does not make a paid model call. Use Settings → connection test to check model access (this is not an inference/billing test).

For remote use, `APP_URL` must be the exact HTTPS origin (no trailing slash), matching what browsers visit. Put Caddy, nginx or another TLS proxy in front of `127.0.0.1:3000`. Preserve the Origin header, disable proxy buffering on conversation SSE responses, and allow several minutes of read timeout for tool-based answers. The app does not trust forwarded IP headers: rate limits are conservative and shared behind a reverse proxy. Configure explicit trusted proxies in a future change if needed; never blindly trust arbitrary `X-Forwarded-For`.

`HOST` defaults to loopback for native runs; Docker sets `0.0.0.0` inside the container while publishing only to host loopback. Use one replica per SQLite database. `/api/health` is unauthenticated and contains no instance data.

## Backups and upgrades

Keep `.env` (especially `ENCRYPTION_KEY`) and the full data directory/volume together in a protected backup. Password hashes, conversations and automation results are not application-encrypted; protect the disk and backups. Never commit backups to Git.

For a consistent simple backup, stop the app, copy/archive the volume including SQLite files, then start it again. For online backups use SQLite's backup API, not a bare copy of the live main DB file. Restore into an empty stopped instance with the same encryption key. Test restoration separately.

Before an upgrade, back up, review release notes, then `git pull --ff-only` on the main checkout and `docker compose up --build -d`. Existing setup stays locked. Do not generate a new encryption key for an existing database. Key rotation and password recovery tooling are not implemented yet; keep your administrator credentials safe.

## Troubleshooting

- **Setup token invalid:** use `SETUP_TOKEN` from this instance's `.env`.
- **Origin rejected:** `APP_URL` must match the exact browser origin. For Vite use `http://localhost:5173`, for the built server normally `http://localhost:3000`.
- **Chat fails:** verify the saved OpenAI model/key, account permissions, billing and provider availability. Failed exchanges are not saved. Reload after network interruptions before retrying.
- **Gmail reconnect required:** verify consent/scopes/client configuration. Google testing-mode grants can expire; see [Gmail setup](gmail.md).
- **Automation late:** keep the server running. Jobs run in sequence; long jobs delay later ones. Inspect the latest execution result.
- **Worktree cleanup skipped:** `.env`, `data/`, dirty files and additional commits are preserved deliberately. Relocate valuable state before retrying.

No telemetry or third-party fonts are loaded by the UI. OpenAI and Google receive requests necessary for configured functionality. OpenAI `store:false` is used for Responses requests; provider account retention policies still apply.
