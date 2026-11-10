# Operations

## Deployment

Use Node.js 24+ or Docker Compose. `node scripts/install.mjs` writes a private `.env` with fresh secrets and prints the setup token. The web wizard creates the admin and configures OpenAI. API credentials are stored locally; setup does not make a paid model call. Use Settings → connection test to check model access (this is not an inference/billing test).

For remote use, `APP_URL` should be the exact HTTPS origin (no trailing slash), matching what browsers visit. Put Caddy, nginx or another TLS proxy in front of `127.0.0.1:3000`. Preserve the Origin header, disable proxy buffering on conversation SSE responses, and allow several minutes of read timeout for tool-based answers. The app does not trust forwarded IP headers: rate limits are conservative and shared behind a reverse proxy. Configure explicit trusted proxies in a future change if needed; never blindly trust arbitrary `X-Forwarded-For`.

`HOST` defaults to loopback for native runs; Docker sets `0.0.0.0` inside the container while publishing only to host loopback. Use one replica per SQLite database. `/api/health` is unauthenticated and contains no instance data.

## Trusted LAN / Unraid

To test directly at `http://YOUR-SERVER-IP:3000`, explicitly opt in during installation:

```sh
node scripts/install.mjs --allow-insecure-http
# Enter http://YOUR-SERVER-IP:3000 when prompted.
docker compose up --build -d
docker compose ps
```

This writes `ALLOW_INSECURE_HTTP=true`, `PUBLISH_ADDRESS=0.0.0.0` and a `PUBLISH_PORT` matching the URL. Existing `.env` files are never overwritten; set these three values and `APP_URL` manually for an existing instance. `PORT` inside the container remains 3000. `PUBLISH_ADDRESS` can instead be a specific host interface IP. Without opt-in, network HTTP is rejected and Compose publishes only on loopback.

HTTP leaves passwords, cookies, API-key entry and chats unencrypted on the network. Use only a trusted LAN; do not forward the port on your router. For Internet access, use a TLS reverse proxy, set the exact HTTPS `APP_URL` and disable `ALLOW_INSECURE_HTTP`. Origin checks still require the exact configured address; do not alternate between localhost, hostnames and IP addresses when logging in.

On Unraid, keep the repository/Compose configuration in a persistent directory and run the same Compose stack (builds `openaipa:local`). If Node.js is unavailable, run the installer using the Node Docker command in the README with `--allow-insecure-http` appended. The default named volume persists `/app/data` across container restarts and recreation. To use Unraid appdata instead, create `/mnt/user/appdata/openaipa` owned by UID/GID **1000:1000** and set `PA_DATA_VOLUME=/mnt/user/appdata/openaipa` before the first start. Switching storage locations does not migrate an existing database; back up and transfer it deliberately. Keep `.env` with its encryption key in protected persistent storage as well.

For manual Unraid container configuration after building/loading the image: use bridge networking, map host port 3000 to container port 3000, mount appdata at `/app/data`, and supply `APP_URL`, `ALLOW_INSECURE_HTTP`, `ENCRYPTION_KEY` and `SETUP_TOKEN`. The image already sets `HOST=0.0.0.0` and `DATA_DIR=/app/data`. No privileged mode or Docker socket access is needed. The image is built locally, not published to a registry yet.

Google OAuth does not support a raw LAN IP / HTTP callback for Gmail. Use an HTTPS domain for Gmail, or localhost when testing on the same machine; see [Google redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation). The LAN HTTP mode is suitable for testing setup, dashboard, chats and non-Gmail tasks.

Stop with `docker compose stop`, resume with `docker compose up -d`, inspect logs with `docker compose logs --tail=50 app`. Do not use `docker compose down -v` unless you intend to delete the database volume.

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
