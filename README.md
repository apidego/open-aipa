# Open AIPA

**Open AI Personal Assistant** — `open-aipa`.

An open-source, self-hosted personal assistant powered by your OpenAI API key. Chat with your PA, connect your tools, and schedule recurring tasks from one clean dashboard.

**Early MVP · MIT licensed · Node.js 24+ · SQLite**

## What works

- Guided first-time setup with a protected, one-time admin creation flow.
- Login, admin-managed users, and private per-user conversations with streamed replies.
- Configurable system prompt, model and encrypted OpenAI API key.
- Gmail OAuth connection per user: search, read and summarize mail through the assistant.
- Recurring assistant tasks, pause/resume controls and execution history.
- Responsive dashboard with an expandable icon sidebar.

The interface is currently German. Gmail is read-only; this version does not send mail, run shell commands, or control your computer. OpenAI usage is billed separately to your account. This project is independent and not affiliated with OpenAI or OpenClaw.

## Install

You need Git and Docker Compose. Run the installer with Node.js 24+, or the Docker alternative below.

```sh
git clone https://github.com/apidego/open-aipa.git
cd open-aipa
node scripts/install.mjs
docker compose up --build -d
```

Without Node.js on the host, replace the installer command with:

```sh
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim node scripts/install.mjs
```

Open **http://localhost:3000**, enter the setup token printed by the installer, create your admin account, and enter your OpenAI API key and model. The installer never overwrites an existing `.env`. Check the saved OpenAI connection in Settings after setup.

For remote access, set your HTTPS origin in the installer and put a TLS reverse proxy in front of port 3000. Docker binds to localhost by default. Back up **both the database volume and `.env`**; losing the encryption key makes stored credentials unreadable. See [operations](docs/operations.md).

For a direct LAN/Unraid test, the installer supports `--allow-insecure-http` with your server IP. This is an explicit opt-in to unencrypted HTTP; see [LAN deployment and persistent appdata](docs/operations.md#trusted-lan--unraid). Default installations remain loopback-only.

## Gmail

Create a Google OAuth web application, enable the Gmail API, and add the exact redirect URI shown under Integrations → Gmail → gear button. Enter the client ID and secret in that dialog (administrator only); each user then connects their own account under Integrations. [Detailed setup and data flow](docs/gmail.md).

For script automations, AI tasks, schedules and dashboard notifications, see [scheduled jobs](docs/scheduled-jobs.md).

## Development

For development in Docker (source changes need no image rebuild):

```sh
docker compose stop
docker compose -f compose.dev.yaml up --build -d --wait
```

Open http://localhost:3000. Edit files and refresh the browser; the backend restarts automatically. Run setup first if `.env` does not exist. See [Docker development](docs/operations.md#docker-development) for dependency updates and switching back.

Or run directly with Node.js:

```sh
npm ci
npm run setup
# For Vite development, set APP_URL=http://localhost:5173 in .env.
npm run dev
```

Open http://localhost:5173. The Vite proxy forwards `/api` to port 3000. For a production run without Docker, set `APP_URL=http://localhost:3000`, then `npm run build && npm start`.

```sh
npm run check
npm test
npm run build
```

## Contributing

Start with an issue, implement in a separate worktree, and submit a PR that closes the issue. After merge, remove the worktree and its local/remote branch. The same cleanup check runs at the start of each agent session; see [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

[Architecture](docs/architecture.md) · [Security](SECURITY.md) · [Issues](https://github.com/apidego/open-aipa/issues) · [MIT license](LICENSE)
