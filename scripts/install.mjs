import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
if (existsSync('.env')) {
  console.log(
    '.env already exists. Keeping existing secrets. Open APP_URL to continue the browser wizard.',
  );
  process.exit(0);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(
  '\nOpen AIPA · Installation\nThe browser wizard creates your admin account and configures OpenAI.\n',
);
const url =
  (await rl.question('Application URL [http://localhost:3000]: ')).trim() ||
  'http://localhost:3000';
const parsed = new URL(url);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
const lanHttp =
  !local && parsed.protocol === 'http:' && process.argv.includes('--allow-insecure-http');
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.origin !== url ||
  (parsed.protocol === 'http:' && !local && !lanHttp)
)
  throw new Error(
    'Use a HTTPS origin or local HTTP origin without a trailing slash. For a trusted LAN only, pass --allow-insecure-http.',
  );
if (lanHttp)
  console.log(
    'LAN HTTP enabled: credentials and chats are not encrypted in transit. Do not expose this port to the Internet.',
  );
const setupToken = randomBytes(32).toString('hex');
writeFileSync(
  '.env',
  `APP_URL=${url}\nHOST=127.0.0.1\nPORT=3000\nPUBLISH_ADDRESS=${lanHttp ? '0.0.0.0' : '127.0.0.1'}\nPUBLISH_PORT=${lanHttp ? parsed.port || '80' : '3000'}\nALLOW_INSECURE_HTTP=${lanHttp ? 'true' : 'false'}\nDATA_DIR=./data\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nSETUP_TOKEN=${setupToken}\n`,
  { mode: 0o600, flag: 'wx' },
);
console.log(
  `\nConfiguration created. Keep .env private and backed up.\n\nSetup token: ${setupToken}\n\nRun docker compose up --build -d, then open ${url}.\nOr run npm ci && npm run build && npm start (Node.js 24+).\n`,
);
rl.close();
