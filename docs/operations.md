# Operations

## Deployment

Use Node.js 24+ or Docker Compose. `node scripts/install.mjs` writes a private `.env` with fresh secrets and prints the setup token. The web wizard creates the admin and configures OpenAI. API credentials are stored locally; setup does not make a paid model call. Use Settings → connection test to check model access (this is not an inference/billing test).

For remote use, `APP_URL` should be the exact HTTPS origin (no trailing slash), matching what browsers visit. Put Caddy, nginx or another TLS proxy in front of `127.0.0.1:3000`. Preserve the Origin header, disable proxy buffering on conversation SSE responses, and allow several minutes of read timeout for tool-based answers. The app does not trust forwarded IP headers: rate limits are conservative and shared behind a reverse proxy. Configure explicit trusted proxies in a future change if needed; never blindly trust arbitrary `X-Forwarded-For`.

`HOST` defaults to loopback for native runs; Docker sets `0.0.0.0` inside the container while publishing only to host loopback. Use one replica per SQLite database. `/api/health` is unauthenticated and contains no instance data.

## Docker development

Use the standalone `compose.dev.yaml` file from the checkout you want to edit:

```sh
# Create .env with the installer first if needed (see README).
docker compose stop
docker compose -f compose.dev.yaml up --build -d --wait
```

Visit **http://localhost:3000**. Source is bind-mounted into the container. Vite serves the frontend directly and proxies `/api` to the watched TypeScript backend. Save a frontend change and refresh with Ctrl+R; backend changes restart the server automatically. Docker Desktop file polling is enabled. The development image runs as the same non-root user as production.

The initial command builds a small development image once. Ordinary source edits require no command or build. Dependencies are installed from the lockfile on every container start into a separate Linux volume; host `node_modules` is not used. After changing `package.json` / `package-lock.json`, run `docker compose -f compose.dev.yaml restart app` and wait for installation to finish. Rebuild only after changing the development Dockerfile stage or base image. Logs: `docker compose -f compose.dev.yaml logs --tail=50 -f app`.

The browser origin is fixed to `http://localhost:3000` and the published port is loopback-only, independent of production LAN settings. `.env` still supplies secrets; it is not rewritten. Use the localhost URL for login and OAuth callbacks.

Development uses the same `pa-data` volume (or `PA_DATA_VOLUME`) as production **when using the same Compose project name**. Stop production before starting development; never run two backends against one database. For another worktree, use `-p ORIGINAL_PROJECT_NAME` on both Compose commands and `PA_ENV_FILE=/absolute/path/to/original/.env` so the existing secrets and database stay paired. The bind mount always points to the checkout containing `compose.dev.yaml`; edit that checkout. Do not use `down -v`, which deletes data. To return to production from its checkout:

```sh
docker compose -f compose.dev.yaml stop
docker compose up --build -d --wait
```

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

On Unraid, keep the repository/Compose configuration in a persistent directory and run the same Compose stack (builds `open-aipa:local`). If Node.js is unavailable, run the installer using the Node Docker command in the README with `--allow-insecure-http` appended. The default named volume persists `/app/data` across container restarts and recreation. To use Unraid appdata instead, create `/mnt/user/appdata/open-aipa` owned by UID/GID **1000:1000** and set `PA_DATA_VOLUME=/mnt/user/appdata/open-aipa` before the first start. Switching storage locations does not migrate an existing database; back up and transfer it deliberately. Keep `.env` with its encryption key in protected persistent storage as well.

For manual Unraid container configuration after building/loading the image: use bridge networking, map host port 3000 to container port 3000, mount appdata at `/app/data`, and supply `APP_URL`, `ALLOW_INSECURE_HTTP`, `ENCRYPTION_KEY` and `SETUP_TOKEN`. The image already sets `HOST=0.0.0.0` and `DATA_DIR=/app/data`. No privileged mode or Docker socket access is needed. The image is built locally, not published to a registry yet.

Google OAuth does not support a raw LAN IP / HTTP callback for Gmail. Use an HTTPS domain for Gmail, or localhost when testing on the same machine; see [Google redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation). The LAN HTTP mode is suitable for testing setup, dashboard, chats and non-Gmail tasks.

Stop with `docker compose stop`, resume with `docker compose up -d`, inspect logs with `docker compose logs --tail=50 app`. Do not use `docker compose down -v` unless you intend to delete the database volume.

## Upgrading from the original repository name

The project is now `open-aipa`, displayed as **Open AIPA** (Open AI Personal Assistant). Update your Git remote to `https://github.com/apidego/open-aipa.git`. Existing local checkout directories do not need to be renamed.

Preserve `.env`, the encryption key and the existing data volume/appdata path. The SQLite filename remains `openaipa.sqlite` for compatibility. If your original Compose project was `openaipa`, keep using `docker compose -p openaipa ...` or set `COMPOSE_PROJECT_NAME=openaipa` in `.env`, even if you rename the checkout directory. This retains the existing `openaipa_pa-data` volume and avoids creating an empty installation. The new image tag is `open-aipa:local`; changing the image tag does not rename or migrate your data. Keep any existing `PA_DATA_VOLUME` binding unchanged.

## Backups and upgrades

Keep `.env` (especially `ENCRYPTION_KEY`) and the full data directory/volume together in a protected backup. Password hashes, conversations and automation results are not application-encrypted; protect the disk and backups. Never commit backups to Git.

For a consistent simple backup, stop the app, copy/archive the volume including SQLite files, then start it again. For online backups use SQLite's backup API, not a bare copy of the live main DB file. Restore into an empty stopped instance with the same encryption key. Test restoration separately.

Before an upgrade, back up, review release notes, then `git pull --ff-only` on the main checkout and `docker compose up --build -d`. Existing setup stays locked. Do not generate a new encryption key for an existing database. Key rotation and password recovery tooling are not implemented yet; keep your administrator credentials safe.

## Troubleshooting

- **Setup token invalid:** use `SETUP_TOKEN` from this instance's `.env`.
- **Origin rejected:** `APP_URL` must match the exact browser origin. For Vite use `http://localhost:5173`, for the built server normally `http://localhost:3000`.
- **Chat fails:** verify the saved OpenAI model/key, account permissions, billing and provider availability. Failed exchanges are not saved. Reload after network interruptions before retrying.
- **Gmail reconnect required:** verify consent/scopes/client configuration. Google testing-mode grants can expire; see [Gmail setup](gmail.md).
- **Task or automation late:** keep the server running. The scheduler checks every 30 seconds and runs jobs sequentially; long jobs delay later ones. Inspect the execution history. See [scheduled jobs](scheduled-jobs.md).
- **Worktree cleanup skipped:** `.env`, `data/`, dirty files and additional commits are preserved deliberately. Relocate valuable state before retrying.

No telemetry or third-party fonts are loaded by the UI. OpenAI and Google receive requests necessary for configured functionality. OpenAI `store:false` is used for Responses requests; provider account retention policies still apply.
